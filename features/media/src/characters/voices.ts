// The voices Flow's character "Select a voice" dialog lists: Gemini's 30 prebuilt TTS voices, in
// Flow's order, with Flow's descriptions and avatar gradients. Each has a static sample on gstatic
// that the dialog's Preview plays.

export interface CharacterVoice {
  name: string;
  description: string;
  /** Top and bottom colours of the voice's avatar and preview card. */
  from: string;
  to: string;
}

export const VOICE_SAMPLE_URL = (name: string): string => `https://www.gstatic.com/aitestkitchen/voices/samples/${name}.wav`;

export const DEFAULT_SAMPLE_DIALOGUE = "Hi there! We're introducing a new feature where I can read this aloud, in a natural, human-like voice.";

export const SAMPLE_DIALOGUE_MAX = 120;

export const CHARACTER_VOICES: CharacterVoice[] = [
  { name: 'Achernar', description: 'Female, soft, high pitch', from: 'rgb(234, 156, 46)', to: 'rgb(210, 187, 221)' },
  { name: 'Achird', description: 'Male, friendly, mid pitch', from: 'rgb(125, 105, 134)', to: 'rgb(255, 173, 66)' },
  { name: 'Algenib', description: 'Male, gravelly, low pitch', from: 'rgb(214, 59, 248)', to: 'rgb(164, 162, 156)' },
  { name: 'Algieba', description: 'Male, easy-going, mid-low pitch', from: 'rgb(221, 70, 158)', to: 'rgb(181, 164, 188)' },
  { name: 'Alnilam', description: 'Male, firm, mid-low pitch', from: 'rgb(153, 128, 230)', to: 'rgb(185, 143, 132)' },
  { name: 'Aoede', description: 'Female, breezy, mid pitch', from: 'rgb(144, 165, 147)', to: 'rgb(180, 186, 148)' },
  { name: 'Autonoe', description: 'Female, bright, mid pitch', from: 'rgb(229, 166, 31)', to: 'rgb(212, 226, 171)' },
  { name: 'Callirrhoe', description: 'Female, easy-going, mid pitch', from: 'rgb(78, 136, 88)', to: 'rgb(180, 164, 204)' },
  { name: 'Charon', description: 'Male, informative, lower pitch', from: 'rgb(255, 36, 28)', to: 'rgb(125, 137, 155)' },
  { name: 'Despina', description: 'Female, smooth, mid pitch', from: 'rgb(157, 168, 162)', to: 'rgb(197, 192, 180)' },
  { name: 'Enceladus', description: 'Male, breathy, lower pitch', from: 'rgb(106, 154, 239)', to: 'rgb(168, 170, 163)' },
  { name: 'Erinome', description: 'Female, clear, mid pitch', from: 'rgb(125, 105, 134)', to: 'rgb(255, 173, 66)' },
  { name: 'Fenrir', description: 'Male, excitable, younger pitch', from: 'rgb(128, 135, 137)', to: 'rgb(188, 191, 191)' },
  { name: 'Gacrux', description: 'Female, mature, mid pitch', from: 'rgb(187, 168, 42)', to: 'rgb(174, 191, 219)' },
  { name: 'Iapetus', description: 'Male, clear, mid-low pitch', from: 'rgb(221, 70, 158)', to: 'rgb(181, 164, 188)' },
  { name: 'Kore', description: 'Female, firm, mid pitch', from: 'rgb(226, 147, 121)', to: 'rgb(167, 172, 164)' },
  { name: 'Laomedeia', description: 'Female, upbeat, mid-high pitch', from: 'rgb(80, 79, 245)', to: 'rgb(206, 194, 197)' },
  { name: 'Leda', description: 'Female, youthful, mid-high pitch', from: 'rgb(87, 91, 214)', to: 'rgb(171, 159, 193)' },
  { name: 'Orus', description: 'Male, firm, mid-low pitch', from: 'rgb(125, 105, 134)', to: 'rgb(255, 173, 66)' },
  { name: 'Puck', description: 'Male, upbeat, mid pitch', from: 'rgb(78, 136, 88)', to: 'rgb(180, 164, 204)' },
  { name: 'Pulcherrima', description: 'Ungendered, forward, mid-high pitch', from: 'rgb(214, 206, 182)', to: 'rgb(190, 213, 195)' },
  { name: 'Rasalgethi', description: 'Male, informative, mid pitch', from: 'rgb(234, 156, 46)', to: 'rgb(210, 187, 221)' },
  { name: 'Sadachbia', description: 'Male, lively, low pitch', from: 'rgb(150, 153, 236)', to: 'rgb(159, 163, 155)' },
  { name: 'Sadaltager', description: 'Male, knowledgeable, mid pitch', from: 'rgb(144, 165, 147)', to: 'rgb(180, 186, 148)' },
  { name: 'Schedar', description: 'Male, even, mid-low pitch', from: 'rgb(87, 91, 214)', to: 'rgb(171, 159, 193)' },
  { name: 'Sulafat', description: 'Female, warm, mid pitch', from: 'rgb(214, 59, 248)', to: 'rgb(164, 162, 156)' },
  { name: 'Umbriel', description: 'Male, smooth, lower pitch', from: 'rgb(144, 165, 147)', to: 'rgb(180, 186, 148)' },
  { name: 'Vindemiatrix', description: 'Female, gentle, mid pitch', from: 'rgb(106, 154, 239)', to: 'rgb(168, 170, 163)' },
  { name: 'Zephyr', description: 'Female, bright, mid-high pitch', from: 'rgb(247, 81, 161)', to: 'rgb(174, 149, 148)' },
  { name: 'Zubenelgenubi', description: 'Male, casual, mid-low pitch', from: 'rgb(125, 105, 134)', to: 'rgb(255, 173, 66)' },
];

export const voiceByName = (name: string | undefined): CharacterVoice | undefined => CHARACTER_VOICES.find((v) => v.name === name);

/** A voice by name, ignoring case, for names typed by a person or a model. */
export const findVoice = (name: unknown): CharacterVoice | undefined => {
  const wanted = String(name ?? '').trim().toLowerCase();
  return wanted ? CHARACTER_VOICES.find((v) => v.name.toLowerCase() === wanted) : undefined;
};
