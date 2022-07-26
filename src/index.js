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
  { name: 'xr18-address', alias: 'a', type: String, defaultValue: '10.9.9.215' },
  { name: 'xr18-port', alias: 'p', type: Number, defaultValue: 10024 },
  { name: 'mqtt-url', alias: 'b', type: String, defaultValue: 'tcp://10.9.9.96:1883' },
  { name: 'mqtt-topic', alias: 't', type: String, defaultValue: 'dev/midi-to-xr18' }
];
const args = commandLineArgs(optionDefinitions);

if (!!args['midi-list-devices']) {
  console.log(easymidi.getInputs());
  process.exit(0);
}

const mappings = require(args.mappings);

const midiDeviceNameParam = args['midi-device'];
const xr18Addr = args['xr18-address'];
const xr18Port = args['xr18-port'];

const udpPort = new osc.UDPPort({
  localAddress: "0.0.0.0",
  localPort: 10023,
  metadata: true
});

let midiDeviceName = easymidi.getInputs().filter(x => x.startsWith(midiDeviceNameParam))[0];

let pubSub;
let midiDevice;
try {
  midiDevice = new easymidi.Input(midiDeviceName);
}
catch (error) {
  console.error(error);
  console.log('Available devices:');
  console.log(easymidi.getInputs());
  process.exit(-1);
}

let state = {};
let stateSaveTimeout = null;
function saveState(oscData, midiData) {
  state[oscData.address] = { osc: oscData, midi: midiData };

  if (!!stateSaveTimeout) clearTimeout(stateSaveTimeout);
  stateSaveTimeout = setTimeout(function() {
    stateSaveTimeout = null;
    fs.writeFile('./state_data.json', JSON.stringify(state), (err) => !!err ? console.log("Error saving state to './stat_data.json': ", err) : 0);
  }, 1000);
}

function loadData() {
  fs.readFile('./state_data.json', function (err, data) {
    if(!!err) {
      console.log("Error saving state to './stat_data.json': ", err);
      return;
    }

    console.log("Reading state from './stat_data.json");
    state = JSON.parse(data);

    mappings.setState(state);

    const midiOutDevice = new easymidi.Output(midiDeviceName);
    for (var i in state) {
      console.log("Recover state for:", state[i]);
      try {
        midiOutDevice.send(state[i].midi._type, state[i].midi);
      }
      catch (e) {
        console.log("Error sending MIDI command: ", e);
      }
    }
  
    midiOutDevice.close();
  });
}

udpPort.open();
udpPort.on('message', function (oscMsg, timeTag, info) {
  console.log("An OSC message received: ", oscMsg);
  console.log("Remote info is: ", info);
});

udpPort.on('ready', () => {
  // udpPort.send({ address: '/info' }, xr18Addr, xr18Port);
  // udpPort.send({ address: '/status' }, xr18Addr, xr18Port);
  // udpPort.send({ address: '/xremote' }, xr18Addr, xr18Port);

  loadData();
});

udpPort.on("error", function (error) {
  console.log("An error occurred on UDP client: ", error.message);
});

udpPort.on("close", () => {
  console.log("OSC UDP port closed remotely! Exiting in 1 sec...");
  setTimeout(() => { process.exit(-2); }, 1000);
});

midiDevice.on('cc', msg => {
  console.log(msg);
  let oscMap = mappings[msg._type][msg.controller] || null;
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
    saveState(data, msg);
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
});

midiDevice.on('program', msg => console.log(msg));

// MQTT
pubSub = mqtt.connect(args['mqtt-url'], { clientId: "midi-to-xr18" });
pubSub.on('connect', () => {
  console.log('MQTT connected!');

  for (var i in mappings.cc) {
    let el = mappings.cc[i];
    let topic = args["mqtt-topic"] + el.oscPath + "/set";

    console.log('Subscribing to MQTT topic: "' + topic + '"');
    pubSub.subscribe(topic, (e) => { if (e) console.warn("Failed to subscribe on MQTT topic: '" + topic + "'", e); });
  }
});

pubSub.on('message', (t, m) => {
  let ms = m.toString();
  console.log('Received message from "' + t + '"', ms);

  try {
    let jm = JSON.parse(ms);

    udpPort.send(jm, xr18Addr, xr18Port);
    // saveState(data, msg);
  }
  catch (error) {
    console.warn("Error sending command from MQTT to XR18!", error);
  }
});

function cleanup() {
  console.log("Cleanup before exit");
  midiDevice.close();
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
