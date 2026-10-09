// Writes features/chat/src/media/images-page-templates.ts from the /images capture
// (tools/ui-research/captures/gemini/media-tools-2026/sidebar/images-templates.json, written by
// scrapers/gemini/media-tools-2026/14-images-templates.cjs) plus the prompts below.
//
// The prompt is what "Choose photo" sends, and Gemini shows it as the user's message. Plushie's
// is Gemini's own, read off a sent turn; the rest are Willow's, in the same style, because
// Gemini's client does not carry them until a template is sent.
const fs = require('fs');
const path = require('path');

const SRC = path.resolve(__dirname, '../ui-research/captures/gemini/media-tools-2026/sidebar/images-templates.json');
const OUT = path.resolve(__dirname, '../../features/chat/src/media/images-page-templates.ts');

/* Keyed by the art's file stem: two templates are both called "Mural". */
const PROMPTS = {
  ROW_mural: 'A giant hand-painted fan mural of the person on a city wall. Bold brushwork, drips and stencil shapes, team colours, fans gathered on the pavement below, late afternoon sun.',
  enamel: 'A shiny enamel pin of the person. Bold gold metal outlines, flat glossy enamel colours, a tiny clutch back, pinned to a denim jacket and shot as a close-up product photo.',
  ROW_slide: 'The person mid-ride on a giant celebratory slide, arms up, with confetti, streamers and balloons in the air. Bright party light, a joyful candid moment.',
  statue: 'An ancient white marble statue of the person, finely carved with classical drapery and weathered edges, standing in a quiet museum hall under soft skylight.',
  florist: 'The person holding an enormous bouquet of exotic blooms: protea, orchids, birds of paradise and trailing greenery. Soft natural light, a lush editorial portrait.',
  origami: 'An origami sculpture of the person folded from crisp coloured paper, every crease and facet visible, standing on a plain studio backdrop under soft light.',
  '90sstyle': 'The person on a 1990s New York street in full \u201990s fashion: baggy denim, a puffer jacket, yellow cabs and a deli sign behind. Grainy film, direct flash.',
  frontrow: 'The person seated front row at a fashion show in a striking outfit, models walking the runway, photographers\u2019 flashes going off, a glamorous crowd.',
  arcade: 'The person in a retro arcade, lit by glowing cabinet screens and neon signs, mid-game at a classic machine, a candid shot on warm film.',
  chibikeychain: 'A cute chibi keychain charm of the person: big head, tiny body, glossy acrylic with a bright outline, hanging from a metal keyring over a soft pastel background.',
  ROW_coach: 'The person as the team\u2019s head coach on the sideline: team jacket, clipboard and whistle, players and stadium lights behind, a game-day moment.',
  bench: 'The person on a city bench in dappled light, patterns of sun and leaf shadow falling across them, warm golden hour, a quiet street portrait.',
  diner: 'The person as a cartoon character printed on a classic white diner mug, bold retro linework and a speech bubble, the mug steaming on a diner counter.',
  plushie: 'Ultra-soft, round, marshmallow-like giant squishy plushie. Pastel fleece version of full outfit, accessories, and hairstyle. Simple embroidered dot eyes and a tiny stitched smile. Plushie rests playfully on a messy, cozy unmade bed surrounded by warm fairy lights.',
  elven: 'The person as an elf in an ancient forest city: delicate elven attire, pointed ears, silver jewellery, towering trees and soft ethereal light.',
  hollywood: 'The person as a 1940s Hollywood star: a glamorous black-and-white studio portrait with sculpted hair, a satin gown or tailored suit, and dramatic key light.',
  skydiver: 'The person mid-jump as a pro skydiver in free fall high above the clouds: a bright jumpsuit, goggles, arms spread, the horizon curving below.',
  headshot: 'A professional headshot of the person: business attire, a clean neutral backdrop, soft studio lighting, sharp focus and a confident expression.',
  popup: 'The person as a paper figure rising from the page of an antique pop-up book, aged paper, folded scenery and hand-lettered captions around them.',
  rainycity: 'The person in a city at night glowing with neon, pink and cyan signs reflected on wet streets, light rain, a cinematic portrait.',
  clawgame: 'The person as a plushie prize inside an arcade claw machine, surrounded by other toys under bright cabinet lights, the claw hovering just above.',
  handdrawn: 'The person in a pastel-coloured world: soft pinks, mint and lilac sets, a matching pastel outfit, a dreamy hand-drawn feel.',
  lavender: 'The person standing in a lavender field in full bloom at golden hour, rows of purple stretching to the hills, soft focus and warm light.',
  watercolor: 'A loose watercolor painting of the person, soft washes and gentle colour bleeds, visible paper texture and a few confident brush lines.',
  polymerclay: 'The person as a polymer-clay character: smooth sculpted shapes, tiny clay accessories and fingerprint texture, posed in a miniature handmade set.',
  mural: 'A colourful urban mural of the person on a brick wall: bold spray-painted shapes, bright blocks of colour, a few paint cans at the foot of the wall.',
  bento: 'The person as a tiny figure sitting in a Japanese bento box among rice, sushi, tamagoyaki and vegetables, shot from above in soft daylight.',
  monstera: 'The person in a lush monstera garden, surrounded by giant glossy leaves, dappled green light and a humid, tropical atmosphere.',
  '70spulp': 'The person on a 1970s pulp movie poster: a dramatic painted illustration, bold title lettering, explosive action behind them and worn, folded paper.',
  ROW_studio: 'The person at a professional studio photoshoot: a seamless backdrop, strobe lights and softboxes, a striking fashion-editorial pose.',
  '90ssitcom': 'The person as the star of a 1990s sitcom: a bright living-room set, a \u201990s outfit and the warm, slightly soft look of the show\u2019s opening credits.',
  yogi: 'The person as a yogi holding a balancing pose on a rock at sunrise, calm and strong, mist over the water behind them.',
  characters: 'The person as a cheerful 1980s theme park mascot in a big costume, waving in a retro park, faded film colours and a sunny sky.',
  bronze: 'A polished bronze sculpture of the person on a stone plinth, with a warm patina and gallery spotlights.',
  zengarden: 'The person in a futuristic zen garden: raked white sand, sculpted stones, sleek minimal architecture and soft diffused light.',
};

const stem = (url) => path.basename(url).replace(/(_p_2x|_thumbnail)\.webp$/, '');
const captured = JSON.parse(fs.readFileSync(SRC, 'utf8'));
const seen = new Set();
const templates = [];
for (const t of captured) {
  const id = stem(t.image);
  if (seen.has(id)) continue;
  seen.add(id);
  const prompt = PROMPTS[id];
  if (!prompt) throw new Error(`no prompt for ${t.name} (${id})`);
  const description = (t.dialog && t.dialog.description) || '';
  const line = description.replace(/\s*Add a photo to see it transform\.?$/, '').trim();
  if (!line) throw new Error(`no dialog line for ${t.name}`);
  templates.push({
    id: `images-page-${id}`,
    name: t.name,
    image: t.image,
    preview: (t.dialog && t.dialog.images[0] && t.dialog.images[0].src) || t.image,
    line,
    prompt,
  });
}

const body = `/**
 * The /images page's templates (Gemini's sidebar Images entry), captured Oct 2026 off the live app
 * by tools/ui-research/scrapers/gemini/media-tools-2026/14-images-templates.cjs; regenerate with
 * tools/media/gen-images-page-templates.cjs. Names, art and each dialog's line are Gemini's. The
 * prompt is what "Choose photo" sends as the user's message: Plushie's is Gemini's own, the rest
 * Willow's, because Gemini's client only has them once a template is sent. Gemini reshuffles the
 * set on every visit, so this is a snapshot.
 */
export interface ImagesPageTemplate {
  id: string;
  name: string;
  /** The portrait card art. */
  image: string;
  /** The dialog's landscape art. */
  preview: string;
  /** The dialog's line above "Add a photo to see it transform." */
  line: string;
  prompt: string;
}

export const IMAGES_PAGE_TEMPLATES: ImagesPageTemplate[] = [
${templates.map((t) => `  ${JSON.stringify(t)},`).join('\n')}
];
`;
fs.writeFileSync(OUT, body);
console.log(`wrote ${templates.length} templates to ${path.relative(process.cwd(), OUT)}`);
