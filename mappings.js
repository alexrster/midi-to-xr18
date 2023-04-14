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
    state[path].value = (conv || midiFloatValueConverter(state[path].max || max || 0.75))(x);
    return state[path].value;
  }
});

const oscMapToFloatMaxTarget = (path, max) => oscMapToFloatTarget(path, undefined, max);

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

const oscToMidiCcCommandFactory = (controller, channel, positiveVal, zeroVal) => (value) => ({
  "_type": "cc",
  "data": {
    "controller": controller,
    "value": value > 0 ? (positiveVal || value) : (zeroVal || 0),
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
        "50": oscMapToConstTarget('/ch/13/mix/on', 127),
        "51": oscMapToConstTarget('/ch/15/mix/on', 127),
        "44": oscMapToConstTarget('/ch/01/mix/on', 127),
        "45": oscMapToConstTarget('/ch/03/mix/on', 127),
        "46": oscMapToConstTarget('/ch/09/mix/on', 127),
        "47": oscMapToConstTarget('/ch/05/mix/on', 127)
      },
      "noteoff": {
        "50": oscMapToConstTarget('/ch/13/mix/on', 0),
        "51": oscMapToConstTarget('/ch/15/mix/on', 0),
        "44": oscMapToConstTarget('/ch/01/mix/on', 0),
        "45": oscMapToConstTarget('/ch/03/mix/on', 0),
        "46": oscMapToConstTarget('/ch/09/mix/on', 0),
        "47": oscMapToConstTarget('/ch/05/mix/on', 0)
      },
      "cc": {
        "5": oscMapToFloatMaxTarget('/ch/01/mix/fader', 1),
        "6": oscMapToFloatMaxTarget('/ch/03/mix/fader', 1),
        "7": oscMapToFloatMaxTarget('/ch/09/mix/fader', 1),
        "8": oscMapToFloatMaxTarget('/ch/05/mix/fader', 1),
        "3": oscMapToFloatMaxTarget('/ch/13/mix/fader', 1),
        "4": oscMapToFloatMaxTarget('/ch/15/mix/fader', 1)
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
        "0": oscMapToFloatTarget('/ch/01/mix/fader'),
        "1": oscMapToFloatTarget('/ch/03/mix/fader'),
        "2": oscMapToFloatTarget('/ch/05/mix/fader'),
        "3": oscMapToFloatTarget('/ch/09/mix/fader'),
        "4": oscMapToFloatTarget('/ch/13/mix/fader'),
        "5": oscMapToFloatTarget('/ch/15/mix/fader'),
        // Buttons are CCs here
        // First vertical 3 button codes: 32, 48, 64
        "32": oscMapToButtonTarget('/-stat/solosw/01'),
        "33": oscMapToButtonTarget('/-stat/solosw/03'),
        "34": oscMapToButtonTarget('/-stat/solosw/05'),
        "35": oscMapToButtonTarget('/-stat/solosw/09'),
        "36": oscMapToButtonTarget('/-stat/solosw/13'),
        "37": oscMapToButtonTarget('/-stat/solosw/15')
      },
    }
  },
  "osc": {
    // MUTE handlers
    "/ch/01/mix/on": [ midiSendCc("nanoKONTROL2", oscToMidiCcCommandFactory(48, 0, 1)), midiSendNoteOn("LPD8", oscToMidiNoteOnCommandFactory(44)), mqttPublish('/ch/01/mix/on') ],
    "/ch/03/mix/on": [ midiSendCc("nanoKONTROL2", oscToMidiCcCommandFactory(49, 0, 1)), midiSendNoteOn("LPD8", oscToMidiNoteOnCommandFactory(45)), mqttPublish('/ch/03/mix/on') ],
    "/ch/05/mix/on": [ midiSendCc("nanoKONTROL2", oscToMidiCcCommandFactory(50, 0, 1)), midiSendNoteOn("LPD8", oscToMidiNoteOnCommandFactory(47)), mqttPublish('/ch/05/mix/on') ],
    "/ch/09/mix/on": [ midiSendCc("nanoKONTROL2", oscToMidiCcCommandFactory(51, 0, 1)), midiSendNoteOn("LPD8", oscToMidiNoteOnCommandFactory(46)), mqttPublish('/ch/09/mix/on') ],
    "/ch/13/mix/on": [ midiSendCc("nanoKONTROL2", oscToMidiCcCommandFactory(52, 0, 1)), midiSendNoteOn("LPD8", oscToMidiNoteOnCommandFactory(50)), mqttPublish('/ch/13/mix/on') ],
    "/ch/15/mix/on": [ midiSendCc("nanoKONTROL2", oscToMidiCcCommandFactory(53, 0, 1)), midiSendNoteOn("LPD8", oscToMidiNoteOnCommandFactory(51)), mqttPublish('/ch/15/mix/on') ],
    // SOLO handlers
    "/-stat/solosw/01": midiSendNoteOn("nanoKONTROL2", oscToMidiCcCommandFactory(32)),
    "/-stat/solosw/03": midiSendNoteOn("nanoKONTROL2", oscToMidiCcCommandFactory(33)),
    "/-stat/solosw/05": midiSendNoteOn("nanoKONTROL2", oscToMidiCcCommandFactory(34)),
    "/-stat/solosw/09": midiSendNoteOn("nanoKONTROL2", oscToMidiCcCommandFactory(35)),
    "/-stat/solosw/13": midiSendNoteOn("nanoKONTROL2", oscToMidiCcCommandFactory(36)),
    "/-stat/solosw/15": midiSendNoteOn("nanoKONTROL2", oscToMidiCcCommandFactory(37))    
  },
  "mqtt": {
    "/ch/01/mix/on/set": oscMapToButtonTarget('/ch/01/mix/on'),
    "/ch/03/mix/on/set": oscMapToButtonTarget('/ch/03/mix/on'),
    "/ch/05/mix/on/set": oscMapToButtonTarget('/ch/05/mix/on'),
    "/ch/09/mix/on/set": oscMapToButtonTarget('/ch/09/mix/on'),
    "/ch/13/mix/on/set": oscMapToButtonTarget('/ch/13/mix/on'),
    "/ch/15/mix/on/set": oscMapToButtonTarget('/ch/15/mix/on')
  }
};

module.exports = mappings;
