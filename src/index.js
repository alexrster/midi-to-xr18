const commandLineArgs = require('command-line-args');
const easymidi = require('easymidi');
const osc = require('osc');
const fs = require('fs');
const { exit } = require('process');
const mqtt = require('mqtt');

const optionDefinitions = [
  { name: 'mappings', alias: 'm', type: String, defaultOption: true, defaultValue: '../mappings.js' },
  { name: 'midi-list-devices', alias: 'l', type: Boolean },
  { name: 'midi-device', alias: 'd', type: String, defaultValue: 'WORLDE easy CTRL' },
  { name: 'midi-out-device', alias: 'o', type: String, defaultValue: 'WORLDE easy CTRL:WORLDE easy CTRL MIDI 1 24:0' },
  { name: 'xr18-address', alias: 'a', type: String, defaultValue: '10.9.9.215' },
  { name: 'xr18-port', alias: 'p', type: Number, defaultValue: 10024 },
  { name: 'mqtt-url', alias: 'b', type: String, defaultValue: 'tcp://rabbitmq.in.qx.zone:1883' },
  { name: 'mqtt-topic', alias: 't', type: String, defaultValue: 'dev/midi-to-xr18' }
];
const args = commandLineArgs(optionDefinitions);

if (!!args['midi-list-devices']) {
  console.log("INPUT DEVICES");
  console.log(easymidi.getInputs());

  console.log("\nOUTPUT DEVICES");
  console.log(easymidi.getOutputs());
  process.exit(0);
}

const mappings = require(args.mappings);

const midiInDeviceNameParam = args['midi-device'];
const midiOutDeviceNameParam = args['midi-out-device'];
const xr18Addr = args['xr18-address'];
const xr18Port = args['xr18-port'];

const udpPort = new osc.UDPPort({
  localAddress: "0.0.0.0",
  localPort: 10023,
  metadata: true
});

var midiIns = {};
var midiOuts = {};
const midiCcThrottlingMs = 20;

var midiInDeviceNames = easymidi.getInputs();
var midiOutDeviceNames = easymidi.getOutputs();

var pubSub;
var midiInDevice, midiOutDevice;
var state = {};
var stateSaveTimeout = null;

try {
  midiInDevice = new easymidi.Input(midiInDeviceNames.filter(x => x.startsWith(midiInDeviceNameParam))[0]);
  midiOutDevice = new easymidi.Output(midiOutDeviceNames.filter(x => x.startsWith(midiOutDeviceNameParam))[0]);
}
catch (error) {
  console.error(error);
  console.log('Available devices:');
  console.log(easymidi.getInputs());
  // process.exit(-1);
}

function saveState(oscData, midiData) {
  state[oscData.address] = { osc: oscData, midi: midiData };

  if (!!stateSaveTimeout) clearTimeout(stateSaveTimeout);
  stateSaveTimeout = setTimeout(function() {
    stateSaveTimeout = null;
    fs.writeFile('./state_data.json', JSON.stringify(state), (err) => !!err ? console.log("Error saving state to './stat_data.json': ", err) : 0);
  }, 1000);
}

function getMidiIn(name) {
  if (!!name) {
    if (!!midiIns[name]) {
      console.log("Resolve MIDI input device from cache: name=" + name + "; device=" + midiIns[name]);
      return midiIns[name];
    }

    console.log("Try find MIDI input device: name=" + name);
    try {
      var devName = midiInDeviceNames.filter(x => x.startsWith(name))[0];
      console.log("Found real MIDI input device name: ", devName);
      midiIns[name] = new easymidi.Input(devName);
      return midiIns[name];
    }
    catch (error) {
      console.warn('Unable to find or open MIDI input device: name="' + name +  '", error=', error);
    }
  }

  return midiInDevice;
}

function getMidiOut(name) {
  if (!!name) {
    if (!!midiOuts[name]) {
      console.log("Resolve MIDI output device from cache: name=" + name + "; device=" + midiOuts[name]);
      return midiOuts[name];
    }

    console.log("Try find MIDI output device: name=" + name);
    try {
      var devName = midiOutDeviceNames.filter(x => x.startsWith(name))[0];
      console.log("Found real MIDI output device name: ", devName);
      midiOuts[name] = new easymidi.Output(devName);
      return midiOuts[name];
    }
    catch (error) {
      console.warn('Unable to find or open MIDI output device: name="' + name +  '", error=', error);
    }
  }

  return midiOutDevice;
}

function loadData() {
  console.log('Loading configuration and mappings');
  for (var d in mappings.midi) {
    console.log("Processing MIDI mappings for device: name=", d);
    var midiIn = getMidiIn(d);
    if (!!midiIn && !midiIn['setupComplete']) {
      var midiCcTimers = {};

      console.log("Setup MIDI input device: name=", d);
      var onMidiCc = function(msg) {
        console.log("Handling MIDI message: ", msg);
        midiCcTimers[msg.controller] = null;
      
        let oscMap = mappings.midi[d][msg._type][msg.controller] || null;
        if (oscMap == null) return;
      
        let type = oscMap.oscValueType;
        let val = oscMap.valueConverter(msg.value);
        let rawVal = msg.value;
        let addr = oscMap.oscPath;
      
        var data = {
          address: addr,
          args: [{
              type: type,
              value: val
          }]
        };
      
        console.log("Mapping found! Sending command to XR18: ", data);
        try {
          udpPort.send(data, xr18Addr, xr18Port);
          // saveState(data, msg);
        }
        catch (error) {
          console.warn("Error sending command to XR18!", error);
        }
      
        try {
          pubSub.publish(args["mqtt-topic"] + addr, JSON.stringify({
            type: type,
            value: val,
            raw_value: rawVal
          }));
        }
        catch (error) {
          console.warn("Error publishing to MQTT!", error);
        }
      };

      midiIn.on('cc', msg => {
        if (midiCcTimers[msg.controller] != null) clearTimeout(midiCcTimers[msg.controller]);
        midiCcTimers[msg.controller] = setTimeout(onMidiCc, midiCcThrottlingMs, msg);
      });
      
      midiIn.on('noteon', msg => {
        console.log(msg);
      });
      
      midiIn.on('noteoff', msg => {
        console.log(msg);
      });
      
      midiIn.on('program', msg => console.log(msg));

      midiIn['setupComplete'] = true;
    }
  }

  return;
  fs.readFile('./state_data.json', function (err, data) {
    if(!!err) {
      console.log("Error saving state to './stat_data.json': ", err);
      return;
    }

    console.log("Reading state from './stat_data.json");
    state = JSON.parse(data);

    mappings.setState(state);

    for (var i in state) {
      console.log("Recover state for:", state[i]);
      try {
        midiOutDevice.send(state[i].midi._type, state[i].midi);
      }
      catch (e) {
        console.log("Error sending MIDI command: ", e);
      }
    }
  });
}

function handleOscMessage(address, args) {
  try {
    let jm = typeof(args) != 'object' ? JSON.parse(args) : args;
    let v = mappings.osc[address]['data'](jm.value);
    let d = getMidiOut(mappings.osc[address]['dev']);
    if (!!v) {
      console.log('Found midi mapping! device=' + d + '; command=', JSON.stringify(v));
      d.send(v._type, v.data);
    }
  }
  catch (error) {
    console.warn("Error sending command to MIDI!", error);
  }
}

udpPort.open();
udpPort.on('message', function (oscMsg, timeTag, info) {
  console.log("An OSC message received: ", oscMsg);
  console.log("Remote info is: ", info);
  
  handleOscMessage(oscMsg.address, oscMsg.args[0]);
});

udpPort.on('ready', () => {
  // udpPort.send({ address: '/info' }, xr18Addr, xr18Port);
  // udpPort.send({ address: '/status' }, xr18Addr, xr18Port);

  console.log('Connection to XR18 established!');
  loadData();

  udpPort.send({ address: '/xremote' }, xr18Addr, xr18Port);
  setInterval(function() { udpPort.send({ address: '/xremote' }, xr18Addr, xr18Port); }, 8000);
});

udpPort.on("error", function (error) {
  console.log("An error occurred on UDP client: ", error.message);
});

udpPort.on("close", () => {
  console.log("OSC UDP port closed remotely! Exiting in 1 sec...");
  setTimeout(() => { process.exit(-2); }, 1000);
});

// MQTT
pubSub = mqtt.connect(args['mqtt-url'], { clientId: "midi-to-xr18" });
pubSub.on('connect', () => {
  console.log('MQTT connected!');

  for (var d in mappings.midi) {
    if (!!mappings.midi[d].cc) {
      for (var i in mappings.midi[d].cc) {
        let el = mappings.midi[d].cc[i];
        let topic = args["mqtt-topic"] + el.oscPath + "/set";

        console.log('Subscribing to MQTT topic: "' + topic + '"');
        pubSub.subscribe(topic, (e) => { if (e) console.warn("Failed to subscribe on MQTT topic: '" + topic + "'", e); });
      }
    }

    if (!!mappings.midi[d].noteon) {
      for (var i in mappings.midi[d].noteon) {
        let el = mappings.midi[d].noteon[i];
        let topic = args["mqtt-topic"] + el.oscPath + "/set";

        console.log('Subscribing to MQTT topic: "' + topic + '"');
        pubSub.subscribe(topic, (e) => { if (e) console.warn("Failed to subscribe on MQTT topic: '" + topic + "'", e); });
      }
    }

    if (!!mappings.midi[d].noteoff) {
      for (var i in mappings.midi[d].noteoff) {
        let el = mappings.midi[d].noteoff[i];
        let topic = args["mqtt-topic"] + el.oscPath + "/set";

        console.log('Subscribing to MQTT topic: "' + topic + '"');
        pubSub.subscribe(topic, (e) => { if (e) console.warn("Failed to subscribe on MQTT topic: '" + topic + "'", e); });
      }
    }
  }

  for (var i in mappings.osc) {
    let topic = args["mqtt-topic"] + i;

    console.log('Subscribing to MQTT topic: "' + topic + '"');
    pubSub.subscribe(topic, (e) => { if (e) console.warn("Failed to subscribe on MQTT topic: '" + topic + "'", e); });
  }
});

pubSub.on('message', (t, m) => {
  let ms = m.toString();
  console.log('Received message from "' + t + '"', ms);

  if (!!t && t.endsWith('/set')) {
    try {
      let jm = JSON.parse(ms);

      udpPort.send(jm, xr18Addr, xr18Port);
      // saveState(data, msg);
    }
    catch (error) {
      console.warn("Error sending command from MQTT to XR18!", error);
    }
  }
  else {
    let address = t.replace(args["mqtt-topic"], "");
    handleOscMessage(address, ms);
  }
});

function cleanup() {
  console.log("Cleanup before exit");
  midiInDevice.close();
  udpPort.close();
}

function exitHandler(opts, exitCode) {
    if (opts.cleanup) cleanup();
    if (opts.exit) process.exit(exitCode || 0);
}

process.on('exit', exitHandler.bind(null,{cleanup:true}));

//catches ctrl+c event
process.on('SIGINT', exitHandler.bind(null, {exit:true}));

process.on('SIGUSR1', exitHandler.bind(null, {exit:true}));
process.on('SIGUSR2', exitHandler.bind(null, {exit:true}));

process.on('uncaughtException', exitHandler.bind(null, {exit:true}));

process.stdin.resume();
