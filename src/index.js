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

function onMidiCc(o) {
  let msg = o.msg;
  let dev = o.dev;
  let timers = o.timers;
  console.log("Handling MIDI message: ", msg);
  timers[msg.controller] = null;

  if (!mappings.midi[dev]) {
    console.log("No MIDI device mappings found: device=", dev);
    return;
  }

  if (!mappings.midi[dev][msg._type]) {
    console.log("No MIDI message type mappings found for the device: messageType=" + msg._type + "; device=", dev);
    return;
  }

  var oscMap = mappings.midi[dev][msg._type][msg.controller];
  if (!oscMap) {
    console.log("Not found OSC mapping: 'mappings.midi[" + dev + "][" + msg._type + "][" + msg.controller + "]'=", oscMap);
    return;
  }

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
}

function loadData() {
  console.log('Loading configuration and mappings');
  for (var d in mappings.midi) {
    console.log("Processing MIDI mappings for device: name=", d);
    var midiIn = getMidiIn(d);
    if (!!midiIn && !midiIn['setupComplete']) {
      var midiCcTimers = {};

      console.log("Setup MIDI input device: name=", d);
      midiIn.on('cc', msg => {
        if (midiCcTimers[msg.controller] != null) clearTimeout(midiCcTimers[msg.controller]);
        midiCcTimers[msg.controller] = setTimeout((function() { onMidiCc(this); }).bind({ msg: msg, dev: d, timers: midiCcTimers}), midiCcThrottlingMs);
      });
      
      midiIn.on('noteon', msg => {
        if (midiCcTimers[msg.controller] != null) clearTimeout(midiCcTimers[msg.controller]);
        midiCcTimers[msg.controller] = setTimeout((function() { onMidiCc(this); }).bind({ msg: msg, dev: d, timers: midiCcTimers}), midiCcThrottlingMs);
      });
      
      midiIn.on('noteoff', msg => {
        if (midiCcTimers[msg.controller] != null) clearTimeout(midiCcTimers[msg.controller]);
        midiCcTimers[msg.controller] = setTimeout((function() { onMidiCc(this); }).bind({ msg: msg, dev: d, timers: midiCcTimers}), midiCcThrottlingMs);
      });
      
      midiIn.on('program', msg => {
        if (midiCcTimers[msg.controller] != null) clearTimeout(midiCcTimers[msg.controller]);
        midiCcTimers[msg.controller] = setTimeout((function() { onMidiCc(this); }).bind({ msg: msg, dev: d, timers: midiCcTimers}), midiCcThrottlingMs);
      });

      midiIn['setupComplete'] = true;
    }
  }
}

function execMapping(mappingFunc, ...params) {
  if (Array.isArray(mappingFunc)) {
    for (var i in mappingFunc)
      if (typeof(mappingFunc[i]) === 'function') mappingFunc[i].call(mappings, params);
  }
  else {
    mappingFunc.call(mappings, params);
  }
}

function handleOscMessage(address, args) {
  try {
    if (!mappings.osc[address]) return;

    let jm = typeof(args) != 'object' ? JSON.parse(args) : args;
    execMapping(mappings.osc[address], jm.value);
  }
  catch (error) {
    console.warn("Failed to handle OSC message!", error);
  }
}

function handleMqttMessage(topic, message) {
  console.log('Received message from MQTT: topic="' + topic + '"', ms);

  try {
    let address = topic.replace(args["mqtt-topic"], "");
    if (!mappings.mqtt[address]) return;

    let ms = message.toString();
    execMapping(mappings.mqtt[address], ms);
  }
  catch (error) {
    console.warn("Failed to handle MQTT message!", error);
  }
}

mappings.getMidiOut = getMidiOut;
mappings.mqttPublish = (topic, message) => pubSub.publish(args["mqtt-topic"] + topic, typeof(message) === 'object' ? JSON.stringify(message) : message);

udpPort.open();
udpPort.on('message', function (oscMsg, timeTag, info) {
  console.log("An OSC message received: ", oscMsg);
  console.log("Remote info is: ", info);
  
  handleOscMessage(oscMsg.address, oscMsg.args[0]);
});

udpPort.on('ready', () => {
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
var subsriptions = {};
pubSub = mqtt.connect(args['mqtt-url'], { clientId: "midi-to-xr18" });
pubSub.on('connect', () => {
  console.log('MQTT connected!');

  for (var d in mappings.mqtt) {
    let topic = mappings.mqtt[d];
    if (!!subsriptions[topic]) {
      subsriptions[topic] = true;
      console.log('Subscribing to MQTT topic: "' + topic + '"');
      pubSub.subscribe(topic, (e) => { if (e) console.warn("Failed to subscribe on MQTT topic: '" + topic + "'", e); });
    }
  }
});

pubSub.on('message', handleMqttMessage);

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
