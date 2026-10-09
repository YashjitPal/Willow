// Writes features/chat/src/media/media-templates.ts from the gallery captures
// (tools/ui-research/captures/gemini/media-tools-2026/gallery/*.json) plus the style prompts below.
const fs = require('fs');
const path = require('path');

const DIR = path.resolve(__dirname, '../ui-research/captures/gemini/media-tools-2026/gallery');
const OUT = path.resolve(__dirname, '../../features/chat/src/media/media-templates.ts');
const read = (f) => JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));

const PROMPTS = {
  image: {
    "'80s rewind": 'Give the person in the photo a full 1980s makeover: big teased hair, bold eyeshadow and blush, neon and denim, as a candid flash photo with warm film grain.',
    "'80s glam": 'Turn the photo into a glamorous 1980s studio portrait: soft-focus haze, shoulder pads, glossy lips, a sparkle backdrop and a dreamy pastel gradient.',
    "'80s vacation": 'Put the person on a 1980s holiday: a sunny resort, retro swimwear and sunglasses, faded Kodachrome colour and a white snapshot border.',
    "'80s disco": 'Put the person on a 1980s disco floor: mirror-ball light, neon haze, sequins and big hair, shot like a flash-lit party photo.',
    Monochrome: 'Restyle the photo as a high-contrast black-and-white fine-art portrait with deep blacks, crisp highlights and fine film grain.',
    Runway: 'Restyle the person mid-stride on a fashion-week runway in a striking couture outfit, with photographers\u2019 flashes and a blurred audience.',
    Technicolor: 'Restyle the photo in the saturated three-strip Technicolor look of 1950s cinema: lush reds and teals, a soft glow, studio light.',
    'Light beams': 'Restyle the photo with dramatic beams of light cutting through haze, throwing bold shafts and shadows across the subject.',
    Moody: 'Restyle the photo with a moody, low-key cinematic grade: deep shadows, muted colour, one soft light source, a quiet atmosphere.',
    'Enamel pin': 'Turn the subject into a glossy enamel pin with gold metal outlines and flat bright colours, on a fabric backing, shot as a product photo.',
    Sketch: 'Turn the photo into a detailed graphite pencil sketch on textured paper, with cross-hatching and a few loose construction lines.',
    'Color block': 'Restyle the photo as a bold colour-block portrait: flat saturated blocks of colour, graphic shapes, a clean modern backdrop.',
    'Oil painting': 'Repaint the photo as a classical oil painting with visible brushwork, rich glazes and the warm chiaroscuro of an old-master portrait.',
    'Mythic fighter': 'Transform the person into an epic mythic warrior in ornate armour, in a battle scene lit by storm light and flying sparks.',
    'Soft portrait': 'Restyle the photo as a soft, flattering portrait: diffused window light, gentle skin tones, shallow depth of field, a calm palette.',
    Dynamite: 'Restyle the photo as an explosive action poster: a fiery blast behind the subject, flying debris and sparks, a heroic low angle.',
    Surreal: 'Turn the photo into a surreal dreamscape: impossible architecture, floating objects and melting forms in a vast desert.',
    Steampunk: 'Reimagine the subject in a steampunk world: brass gears, goggles, Victorian clothing, airships and warm smoky light.',
    Salon: 'Give the person a fresh salon look, a polished new cut and styling, photographed in a bright salon against a clean backdrop.',
    Cinematic: 'Restyle the photo as a still from a big-budget film: anamorphic widescreen framing, a teal-and-orange grade, atmospheric haze.',
    Cyborg: 'Transform the subject into a sleek cyborg with exposed circuitry, chrome plating and glowing details, in a high-tech lab.',
    'Old cartoon': 'Redraw the scene as a 1930s rubber-hose cartoon: black-and-white ink, bouncy limbs, pie-cut eyes and film scratches.',
    Sunrise: 'Restyle the photo in golden sunrise light: long warm shadows, a lens flare, soft mist and a glowing sky.',
    'Gothic clay': 'Turn the subject into a stop-motion clay figure on a gothic set: pale clay, dark whimsical architecture, moody light.',
  },
  video: {
    'Career day': 'A quick montage of the person trying on different careers (astronaut, chef, surgeon, firefighter), a new outfit and setting in each shot.',
    'Video game': 'Turn the person into a character in a stylised 3D video game, with a HUD, a level-up moment and game-world scenery.',
    'Edible city': 'A city built entirely from food (cake towers, candy cars, chocolate rivers) seen in one slow sweeping camera move.',
    Noir: 'Give the scene a 1940s film-noir look: black and white, venetian-blind shadows, rain-slick streets and a slow push-in.',
    'Pop-up card': 'A paper pop-up greeting card opening, its layers unfolding into a 3D scene around the message.',
    '360 photo booth': 'A 360-degree photo-booth shot: the camera orbits the subject as they pose and the background lights pulse.',
    'Science concept': 'A clear animated explanation of the science concept, with labelled 3D models and smooth camera moves.',
    Pixelate: 'The scene breaks into chunky pixels and resolves into an animated 16-bit version of itself.',
    Montage: 'An energetic montage of the photos with quick cuts, light leaks and gentle push-ins.',
    'Decades fashion': 'The person cycles through fashion from the 1920s to today, outfit and setting changing with each decade.',
    'Tiny world': 'Turn the scene into a tilt-shift miniature, with tiny people and cars moving like toys.',
    Origami: 'Everything in the scene is folded paper, animating with crisp origami folds.',
    'Talking pets': 'The pet in the photo talks to the camera with natural mouth movement and expressive reactions.',
    'Chaotic vlog': 'A handheld, chaotic vlog: fast cuts, whip pans, on-screen captions and a host talking to camera.',
    'Birthday balloons': 'Shiny foil balloons spell out the birthday message, bobbing in a room full of confetti.',
    'Analyze me': 'A playful sci-fi scan of the subject, with holographic readouts and analysis overlays.',
    Walkthrough: 'A smooth first-person walkthrough of the space, gliding from room to room.',
    'Logo reveal': 'A polished logo reveal: elements assemble with light streaks and a glint, then hold on the logo.',
    Moon: 'The person walks on the Moon in a spacesuit, Earth rising behind them, dust drifting in slow motion.',
    Anniversary: 'A warm anniversary video: soft light, candid moments and a heartfelt message.',
    'Product showcase': 'A premium product showcase: a slow orbit on a clean backdrop, studio light, macro detail shots.',
    'Plush world': 'Everything in the scene becomes soft felt and plush, gently bouncing and squishing.',
    Anime: 'Transform the scene into hand-drawn anime with cel shading, speed lines and dramatic light.',
    'Cut paper': 'The text animates in layered cut paper, pieces sliding and popping into place.',
    '8-bit adventure': 'An 8-bit side-scrolling adventure: chunky sprites, a scrolling level and chiptune energy.',
    'Meme me': 'Recreate a classic meme format starring the person, timed for comedy.',
    "80's music video": 'Rewind the scene into a 1980s music video: VHS grain, neon grids, smoke and dramatic slow motion.',
    'Comic book': 'Turn the person into a comic-book hero: halftone dots, ink outlines, action panels and sound effects.',
    'Indie pastel': 'A symmetrical indie-film scene in soft pastels, centred framing and deadpan charm, opening on a chapter title card.',
    'Step into history': 'The person steps into a historical moment and meets the figure they name, in period setting and costume.',
    'Doodle effects': 'Add hand-drawn animated doodles (sparkles, arrows, scribbles) that track the action in the video.',
    'Party invite': 'An animated party invitation with the event details, festive motion and confetti.',
    Storybook: 'A storybook come to life: illustrated pages turn and the characters animate on them.',
  },
  music: {
    'Hometown tribute': 'A heartfelt anthem for the user\u2019s hometown, its streets, people and memories, with a sing-along chorus.',
    'Speech to song': 'Set the user\u2019s speech to music, keeping their words as the lyrics over a fitting backing track.',
    'Happy birthday': 'An upbeat birthday song that names the person celebrating.',
    Comedy: 'A funny song with witty, punchy lyrics about the user\u2019s topic.',
    'Sports recap': 'A high-energy recap track that narrates the game\u2019s big moments like a stadium anthem.',
    'Weather report': 'A playful jingle that sings the weather report for the user\u2019s location.',
    'Love story': 'A romantic ballad that tells the user\u2019s love story.',
    'Party invite': 'A catchy invitation song with the event\u2019s details in the lyrics.',
    Soundscape: 'An immersive ambient soundscape of the setting, without vocals.',
    'Intro music': 'A short, punchy intro theme for what the user is introducing.',
    'Memorize something': 'A catchy, repetitive song with the facts to memorise in its lyrics.',
    'Background music': 'Unobtrusive instrumental background music that suits what it is for.',
    'Team anthem': 'A rousing team anthem with a chantable chorus.',
    'Text messages': 'Turn the text-message conversation into a song, using the messages as lyrics.',
    'Brand jingle': 'A short, memorable brand jingle built on one hook.',
    'Birthday roast': 'A cheeky birthday roast song, teasing but affectionate.',
    'Ode to your pet': 'A sweet ode to the user\u2019s pet and its quirks.',
    'Rap battle': 'A back-and-forth rap battle between the two sides, with clever bars.',
    Ringtone: 'A short, loopable ringtone in the mood described.',
    'Business promo': 'An upbeat promo track for the business that names what it offers.',
    Montage: 'A montage track that builds from calm to triumphant.',
    Streaming: 'A looping, vocal-free backing track for a stream in the mood described.',
    'Say it with a track': 'A song that delivers the user\u2019s message to the person it is for.',
    'Friend appreciation': 'A warm song of appreciation for the user\u2019s friend.',
  },
};

const slug = (s) => s.toLowerCase().replace(/[\u2019']/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const previews = read('music-previews.json');
const sections = [];
for (const [kind, file, tool] of [['image', 'image.json', 'images'], ['video', 'video.json', 'video'], ['music', 'music.json', 'music']]) {
  const d = read(file);
  const tabs = Object.keys(d.tabs);
  const templates = d.cards.map((card) => {
    const pick = d.picks.find((p) => p.label === card.label) || {};
    const prompt = PROMPTS[kind][card.label];
    if (!prompt) throw new Error(`no prompt for ${kind} "${card.label}"`);
    const t = {
      id: `${kind}-${slug(card.label)}`,
      name: card.label,
      image: card.src,
      ...(kind === 'video' && card.hoverSrc ? { hoverImage: card.hoverSrc } : {}),
      ...(kind === 'music' && previews[card.label] && previews[card.label][0] ? { audio: previews[card.label][0] } : {}),
      placeholder: pick.placeholder || 'Describe your idea',
      prompt,
      tabs: tabs.filter((tab) => tab !== 'All' && d.tabs[tab].includes(card.label)),
    };
    return t;
  });
  sections.push(`  ${tool}: {\n    tabs: ${JSON.stringify(tabs)},\n    templates: [\n${templates.map((t) => `      ${JSON.stringify(t)},`).join('\n')}\n    ],\n  },`);
}

const ts = `/**
 * The creation tools' zero-state galleries, as Gemini shows them (captured Oct 2026 off the live
 * app by tools/ui-research/scrapers/gemini/media-tools-2026/06-gallery.cjs and 07-music-previews.cjs;
 * regenerate with tools/media/gen-media-templates.cjs). Names, art, previews, tabs and each
 * template's prompt-box placeholder are Gemini's; \`prompt\` is Willow's own, because the style a
 * template asks for is not visible in Gemini's client. Gemini serves the set from its server and
 * reshuffles it, so this is a snapshot.
 */
export interface MediaTemplate {
  id: string;
  name: string;
  /** The card art, also the prompt-box tile. */
  image: string;
  /** Video: the animated art the card swaps to under the pointer. */
  hoverImage?: string;
  /** Music: the "Preview track" clip. */
  audio?: string;
  /** What the prompt box asks for once the template is picked. */
  placeholder: string;
  /** The style the generator is asked for. */
  prompt: string;
  /** Tabs besides All. */
  tabs: string[];
}

export type GalleryTool = 'images' | 'video' | 'music';

export const MEDIA_GALLERY: Record<GalleryTool, { tabs: string[]; templates: MediaTemplate[] }> = {
${sections.join('\n')}
};

export const isGalleryTool = (tool: string | null | undefined): tool is GalleryTool =>
  tool === 'images' || tool === 'video' || tool === 'music';
`;
fs.writeFileSync(OUT, ts);
console.log('wrote', OUT);
