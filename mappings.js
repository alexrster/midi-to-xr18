let state = {};

const midiFloatValueConverter = max => x => x / 127.0 * max;
const midiBoolValueConverter = x => !!x ? "1" : "0";

const oscMapToFloatTarget = (path, conv) => ({
  "oscPath": path,
  "oscValueType": "f",
  "valueConverter": x => {
    if (!state[path]) state[path] = {};
    state[path].current = x;
    state[path].value = (conv || midiFloatValueConverter(state[path].max || 0.75))(x);
    return state[path].value;
  }
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

module.exports = {
  "setState": s => state = s,
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
  },
  "midi": {
    "/ch/01/mix/on": { "data": oscToMidiNoteOnCommandFactory(44), "dev": "LPD8" },
    "/ch/03/mix/on": { "data": oscToMidiNoteOnCommandFactory(45), "dev": "LPD8" },
    "/ch/05/mix/on": { "data": oscToMidiNoteOnCommandFactory(47), "dev": "LPD8" }
  }
};
