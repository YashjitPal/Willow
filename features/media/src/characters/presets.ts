// The six sample characters on Flow's "New character" page, with Flow's own portraits. Flow asks a
// model to write a fresh description when one is pressed; Willow picks one of these instead, so a
// press never spends the user's key.

export interface CharacterPreset {
  title: string;
  description: string;
  image: string;
  samples: string[];
}

const IMAGE = (slug: string) => `https://www.gstatic.com/aitestkitchen/website/flow/flow_characters/${slug}.jpeg`;

export const CHARACTER_PRESETS: CharacterPreset[] = [
  {
    title: 'The Eccentric',
    description: 'Unforgettable quirky humans. Magnetic scene-stealers with offbeat charm.',
    image: IMAGE('the_eccentric'),
    samples: [
      'The subject features an astonishingly elongated jaw and an imposing, arching hawk nose beneath wide, spherical eyes. Towering above, their hair forms a gravity-defying, architectural cylinder of dense coils. Draped over disproportionately narrow shoulders, an oversized, asymmetric moiré coat displays massive stiffened lapels, buttoned with mismatched, polished bone discs along its heavy, textured weave.',
      'A wiry, beanpole figure with a pencil-thin moustache waxed into perfect spirals and round tortoiseshell spectacles perched on the very tip of a long, freckled nose. Their copper hair is teased into two symmetrical horns, and they wear a pistachio velvet suit with flared cuffs, a ruffled lilac cravat and a pocket watch the size of a saucer on a braided chain.',
      'A cheerful, round-faced eccentric with rosy, apple cheeks, a gap-toothed grin and enormous bushy eyebrows that arch independently. A towering knitted hat in clashing stripes slumps to one side over a halo of white curls, and a patchwork cardigan sewn from a dozen different tweeds hangs to the knees over polka-dot trousers.',
    ],
  },
  {
    title: 'The Professional',
    description: 'Clean cut, well spoken, competent',
    image: IMAGE('the_professional'),
    samples: [
      'A composed woman in her early forties with close-cropped natural hair, high cheekbones and a calm, attentive gaze. She wears a crisp white mandarin-collar shirt under a tailored charcoal blazer, a slim gold watch and small pearl studs, and holds herself with the easy stillness of someone used to being listened to.',
      'A clean-shaven man in his thirties with neatly side-parted dark hair, rimless glasses and a warm, reassuring half-smile. His navy suit is precisely tailored over a pale blue shirt and a knitted tie, and a leather portfolio is tucked under one arm.',
      'A meticulous chef in a spotless double-breasted white jacket, sleeves rolled to the forearm, with short silver-flecked hair and steady, focused eyes. A folded towel hangs from the apron string and a thermometer pen sits in the breast pocket.',
    ],
  },
  {
    title: 'The Wildcard',
    description: 'Beyond human, anything can be a character, right?',
    image: IMAGE('the_wildcard'),
    samples: [
      'A sentient porcelain teapot with a delicate cobalt floral glaze, a chipped spout that serves as a long expressive nose and two tiny brass hinges for eyebrows. It stands on spindly copper legs and wears a miniature tweed waistcoat with a single gleaming button.',
      'A towering humanoid figure carved from translucent violet crystal, its faceted face catching light in shifting prisms. Thin seams of molten gold run along its joints, and a cape of woven copper wire drapes from its angular shoulders.',
      'A small, round moss golem with a soft emerald coat, wildflowers sprouting across its head like a crown and two glowing amber pebbles for eyes. Tiny ferns curl from its shoulders, and it carries a walking stick made from a twisted birch twig.',
    ],
  },
  {
    title: 'The Familiar',
    description: 'Grounded and authentic, a relatable anchor for your story',
    image: IMAGE('the_familiar'),
    samples: [
      'A weathered fisherman in his late fifties with sun-creased olive skin, a salt-and-pepper beard and kind, tired eyes. He wears a faded olive field jacket over a grey henley, a knitted watch cap pushed back on his head, and hands roughened by years of rope and net.',
      'A young nurse in her twenties with dark wavy hair pulled into a practical bun, a few loose strands framing a friendly, freckled face. She wears navy scrubs under an oversized grey cardigan, a lanyard full of badges and a pen behind one ear.',
      'A retired schoolteacher in his seventies with neatly combed white hair, wire-rimmed reading glasses on a chain and a warm, crinkly smile. He wears a moss-green cardigan with leather elbow patches over a checked shirt.',
    ],
  },
  {
    title: 'The Wicked',
    description: 'Powerful antagonistic figures that command the screen',
    image: IMAGE('the_wicked'),
    samples: [
      'A severe woman with a sharp black bob cut straight across the brow, pale porcelain skin and cold, unblinking grey eyes. She wears a high-necked black turtleneck under a structured coat with exaggerated shoulders, a single silver ring on each index finger.',
      'A gaunt aristocrat with slicked-back silver hair, a hawkish profile and a thin, knowing smile. He wears a midnight-blue velvet frock coat embroidered with tarnished gold thread, a black silk cravat and a signet ring bearing a coiled serpent.',
      'A hulking warlord with a scarred, shaved head, a braided iron-grey beard and eyes like flint. Layered black leather armour is studded with dark steel, and a heavy fur mantle hangs from one shoulder.',
    ],
  },
  {
    title: 'The Fantastical',
    description: 'Ethereal, dreamlike beings fusing the human and the mythical',
    image: IMAGE('the_fantastical'),
    samples: [
      'An ethereal figure with luminous alabaster skin, platinum hair that drifts as if underwater and pale, silvery eyes. A collar of frosted glass petals rises around the neck, and a gown of layered translucent organza shimmers with faint iridescence.',
      'A forest spirit with bark-textured skin in soft umber tones, antlers twined with ivy and tiny white blossoms, and eyes that glow a gentle chartreuse. A cloak of living moss and fallen leaves trails from the shoulders.',
      'A celestial oracle with deep indigo skin scattered with faint constellations, a crown of floating gold rings and long white hair braided with strands of starlight. Robes of liquid silver pool around bare feet.',
    ],
  },
];
