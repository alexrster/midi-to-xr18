var state = {};
var mappings = {};

const midiFloatValueConverter = max => x => x / 127.0 * max;
const midiBoolValueConverter = x => !!x ? "1" : "0";

const oscMapToFloatTarget = (path, conv, max) => ({
  "oscPath": path,
  "oscValueType": "f",
  "valueConverter": x => {
    if (!state[path]) state[path] = {};
    state[path].current = x;
    state[path].value = (conv || midiFloatValueConverter(state[path].max || max))(x);
    return state[path].value;
  }
});

const oscMapToConstTarget = (path, val) => ({
  "oscPath": path,
  "oscValueType": "i",
  "valueConverter": (x) => val
});

const oscMapToButtonTarget = path => ({
  "oscPath": path,
  "oscValueType": "i",
  "valueConverter": midiBoolValueConverter
});

const oscMapToFloatFromPathMax = (path) => ({
  "oscPath": path,
  "oscValueType": "f",
  "valueConverter": x => {
    if (!state[path]) state[path] = {};
    state[path].max = 0.75 + midiFloatValueConverter(0.25)(x);
    return midiFloatValueConverter(state[path].max)(state[path].current || x);
  }
});

const oscToMidiCcCommandFactory = (controller, channel) => (value) => ({
  "_type": "cc",
  "data": {
    "controller": controller,
    "value": value > 0 ? 127 : 0,
    "channel": (channel || 0)
  }
});

const oscToMidiNoteOnCommandFactory = (note, channel) => (value) => ({
  "_type": "noteon",
  "data": {
    "note": note,
    "velocity": value > 0 ? 127 : 0,
    "channel": (channel || 0)
  }
});

const midiSend = (device, type, dataFunc) => (v) => { 
  let dev = mappings.getMidiOut(device);
  if (!dev) {
    console.warn('Cannot find MIDI out device!', device);
    return;
  }

  let m = dataFunc(v);  
  if (m !== null && m !== undefined && !!type) 
    try {
      console.log('Sending MIDI command.', device, type, m.data);
      dev.send(type, m.data); 
    }
    catch (e) {
      console.warn('Failed to send MIDI command!', device, type, m.data, e);
    }
};

var midiSendNoteOn = (device, dataFunc) => midiSend(device, 'noteon', dataFunc);
var midiSendNoteOff = (device, dataFunc) => midiSend(device, 'noteoff', dataFunc);
var midiSendCc = (device, dataFunc) => midiSend(device, 'cc', dataFunc);

var mqttPublish = (topic) => (v) => mappings.mqttPublish(topic, v);

mappings = {
  "setState": s => state = s,
  "midi": {
    "LPD8": {
      "noteon": {
        "42": oscMapToConstTarget('/ch/13/mix/on', 127),
        "43": oscMapToConstTarget('/ch/15/mix/on', 127),
        "44": oscMapToConstTarget('/ch/01/mix/on', 127),
        "45": oscMapToConstTarget('/ch/03/mix/on', 127),
        "46": oscMapToConstTarget('/ch/09/mix/on', 127),
        "47": oscMapToConstTarget('/ch/05/mix/on', 127)
      },
      "noteoff": {
        "42": oscMapToConstTarget('/ch/13/mix/on', 0),
        "43": oscMapToConstTarget('/ch/15/mix/on', 0),
        "44": oscMapToConstTarget('/ch/01/mix/on', 0),
        "45": oscMapToConstTarget('/ch/03/mix/on', 0),
        "46": oscMapToConstTarget('/ch/09/mix/on', 0),
        "47": oscMapToConstTarget('/ch/05/mix/on', 0)
      },
      "cc": {
        "3": oscMapToFloatTarget('/ch/13/mix/fader', null, 1),
        "4": oscMapToFloatTarget('/ch/15/mix/fader', null, 1),
        "5": oscMapToFloatTarget('/ch/01/mix/fader', null, 1),
        "6": oscMapToFloatTarget('/ch/03/mix/fader', null, 1),
        "7": oscMapToFloatTarget('/ch/09/mix/fader', null, 1),
        "8": oscMapToFloatTarget('/ch/05/mix/fader', null, 1)
      }
    },
    "WORLDE": {
      "cc": {
        "3":  oscMapToFloatTarget('/ch/01/mix/fader'),         // 1 - fader
        "4":  oscMapToFloatTarget('/ch/03/mix/fader'),         // 2 - fader
    //    "5":  oscMapToFloatTarget('/ch/05/mix/fader'),         // 3 - fader
        "6":  oscMapToFloatTarget('/ch/09/mix/fader'),         // 4 - fader
        "7":  oscMapToFloatTarget('/ch/13/mix/fader'),         // 5 - fader
        "8":  oscMapToFloatTarget('/ch/15/mix/fader'),         // 6 - fader
        "11": oscMapToFloatTarget('/lr/mix/fader'),            // 9 - fader

        "23": oscMapToButtonTarget('/ch/01/mix/on'),           // 1 - on/off
        "24": oscMapToButtonTarget('/ch/03/mix/on'),           // 2 - on/off
        "25": oscMapToButtonTarget('/ch/05/mix/on'),           // 3 - on/off
        "26": oscMapToButtonTarget('/ch/09/mix/on'),           // 4 - on/off
        "27": oscMapToButtonTarget('/ch/13/mix/on'),           // 5 - on/off
        "28": oscMapToButtonTarget('/ch/15/mix/on'),           // 6 - on/off
        "31": oscMapToButtonTarget('/lr/mix/on'),              // 9 - on/off

        "14": oscMapToFloatFromPathMax('/ch/01/mix/fader'),    // 1 - fader
        "15": oscMapToFloatFromPathMax('/ch/03/mix/fader')     // 2 - fader
      }
    },
    "nanoKONTROL2": {
      "cc": {
        "3": () => console.log
      }
    }
  },
  "osc": {
    "/ch/01/mix/on": [ midiSendNoteOn("LPD8", oscToMidiNoteOnCommandFactory(44)), mqttPublish('/ch/01/mix/on') ],
    "/ch/03/mix/on": [ midiSendNoteOn("LPD8", oscToMidiNoteOnCommandFactory(45)), mqttPublish('/ch/03/mix/on') ],
    "/ch/05/mix/on": [ midiSendNoteOn("LPD8", oscToMidiNoteOnCommandFactory(47)), mqttPublish('/ch/05/mix/on') ]
  },
  "mqtt": {
    "/ch/01/mix/on/set": oscMapToButtonTarget('/ch/01/mix/on'),
    "/ch/03/mix/on/set": oscMapToButtonTarget('/ch/03/mix/on'),
    "/ch/05/mix/on/set": oscMapToButtonTarget('/ch/05/mix/on')
  }
};

module.exports = mappings;
