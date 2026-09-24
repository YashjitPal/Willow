/**
 * Live2D Character Models Catalogue
 * Curated from the official Waifu AI ecosystem with public CDN URLs.
 */

export interface Live2DModelMeta {
  id: string;
  name: string;
  url: string;
  fallbackUrl?: string;
  image: string;
  series?: string;
  description?: string;
}

export const WAIFU_MODELS: Live2DModelMeta[] = [
  {
    id: 'hiyori',
    name: 'Hiyori',
    url: 'https://cdn.jsdelivr.net/gh/Live2D/CubismWebSamples@develop/Samples/Resources/Hiyori/Hiyori.model3.json',
    fallbackUrl: 'https://raw.githubusercontent.com/Live2D/CubismWebSamples/develop/Samples/Resources/Hiyori/Hiyori.model3.json',
    image: 'https://raw.githubusercontent.com/waifuai/waifu-companion/main/app/assets/hiyori.png',
    series: 'Live2D Official',
    description: 'A bright, expressive, cheerful student companion with dynamic idle animations.',
  },
  {
    id: 'haru',
    name: 'Haru',
    url: 'https://cdn.jsdelivr.net/gh/guansss/pixi-live2d-display/test/assets/haru/haru_greeter_t03.model3.json',
    fallbackUrl: 'https://raw.githubusercontent.com/guansss/pixi-live2d-display/master/test/assets/haru/haru_greeter_t03.model3.json',
    image: 'https://raw.githubusercontent.com/waifuai/waifu-companion/main/app/assets/haru.png',
    series: 'Live2D Official',
    description: 'Gentle and welcoming greeter model with soft natural expressions.',
  },
  {
    id: 'mao',
    name: 'Mao',
    url: 'https://cdn.jsdelivr.net/gh/Live2D/CubismWebSamples@develop/Samples/Resources/Mao/Mao.model3.json',
    fallbackUrl: 'https://raw.githubusercontent.com/Live2D/CubismWebSamples/develop/Samples/Resources/Mao/Mao.model3.json',
    image: 'https://raw.githubusercontent.com/waifuai/waifu-companion/main/app/assets/mao.png',
    series: 'Live2D Official',
    description: 'Curious, energetic, and playful anime heroine.',
  },
  {
    id: 'rice',
    name: 'Rice',
    url: 'https://cdn.jsdelivr.net/gh/Live2D/CubismWebSamples@develop/Samples/Resources/Rice/Rice.model3.json',
    fallbackUrl: 'https://raw.githubusercontent.com/Live2D/CubismWebSamples/develop/Samples/Resources/Rice/Rice.model3.json',
    image: 'https://raw.githubusercontent.com/waifuai/waifu-companion/main/app/assets/rice.png',
    series: 'Live2D Official',
    description: 'Cute chibi companion with wide, reactive eye expressions.',
  },
  {
    id: 'senko',
    name: 'Senko',
    url: 'https://cdn.jsdelivr.net/gh/Eikanya/Live2d-model/Live2D/Senko_Normals/senko.model3.json',
    image: 'https://raw.githubusercontent.com/waifuai/waifu-companion/main/app/assets/senko.png',
    series: 'Sewayaki Kitsune no Senko-san',
    description: 'Helpful fox spirit dedicated to pampering and de-stressing you.',
  },
  {
    id: 'mori_miko',
    name: 'Mori Miko',
    url: 'https://cdn.jsdelivr.net/gh/Eikanya/Live2d-model/galgame%20live2d/Fox%20Hime%20Zero/mori_miko/mori_miko.model3.json',
    image: 'https://raw.githubusercontent.com/waifuai/waifu-companion/main/app/assets/mori.png',
    series: 'Fox Hime Zero',
    description: 'Fox shrine maiden with flowing traditional dress and mystical charm.',
  },
  {
    id: 'z46',
    name: 'Z46',
    url: 'https://cdn.jsdelivr.net/gh/Eikanya/Live2d-model/%E7%A2%A7%E8%93%9D%E8%88%AA%E7%BA%BF%20Azue%20Lane/Azue%20Lane(JP)/z46_4/z46_4.model3.json',
    image: 'https://raw.githubusercontent.com/waifuai/waifu-companion/main/app/assets/02.png',
    series: 'Azur Lane',
    description: 'Introspective shipgirl with poetic sensibilities and quiet affection.',
  },
  {
    id: 'z23',
    name: 'Z23',
    url: 'https://cdn.jsdelivr.net/gh/Eikanya/Live2d-model/%E7%A2%A7%E8%93%9D%E8%88%AA%E7%BA%BF%20Azue%20Lane/Azue%20Lane(JP)/z23/z23.model3.json',
    image: 'https://raw.githubusercontent.com/waifuai/waifu-companion/main/app/assets/03.png',
    series: 'Azur Lane',
    description: 'Studious, reliable, and attentive commander aide.',
  },
  {
    id: 'richelieu',
    name: 'Richelieu',
    url: 'https://cdn.jsdelivr.net/gh/Eikanya/Live2d-model/%E5%87%8D%E4%BA%ACNerco/l2d/l2d00203/l2d00203.model3.json',
    image: 'https://raw.githubusercontent.com/waifuai/waifu-companion/main/app/assets/01.png',
    series: 'Azur Lane',
    description: 'Elegant cardinal battleship with commanding grace and warmth.',
  },
  {
    id: 'laffey',
    name: 'Laffey',
    url: 'https://cdn.jsdelivr.net/gh/Eikanya/Live2d-model/%E7%A2%A7%E8%93%9D%E8%88%AA%E7%BA%BF%20Azue%20Lane/Azue%20Lane(JP)/lafei/lafei.model3.json',
    image: 'https://raw.githubusercontent.com/waifuai/waifu-companion/main/app/assets/13.png',
    series: 'Azur Lane',
    description: 'Sleepy, laid-back bunny girl who loves naps and relaxed conversation.',
  },
  {
    id: 'unicorn',
    name: 'Unicorn',
    url: 'https://cdn.jsdelivr.net/gh/Eikanya/Live2d-model/%E7%A2%A7%E8%93%9D%E8%88%AA%E7%BA%BF%20Azue%20Lane/Azue%20Lane(JP)/dujiaoshou_6/dujiaoshou_6.model3.json',
    image: 'https://raw.githubusercontent.com/waifuai/waifu-companion/main/app/assets/17.png',
    series: 'Azur Lane',
    description: 'Sweet, protective, and affectionate companion with her plushie Ugean.',
  },
  {
    id: 'akashi',
    name: 'Akashi',
    url: 'https://cdn.jsdelivr.net/gh/Eikanya/Live2d-model/%E7%A2%A7%E8%93%9D%E8%88%AA%E7%BA%BF%20Azue%20Lane/Azue%20Lane(JP)/mingshi/mingshi.model3.json',
    image: 'https://raw.githubusercontent.com/waifuai/waifu-companion/main/app/assets/10.png',
    series: 'Azur Lane',
    description: 'Crafty catgirl shopkeeper who peppers her speech with nya~',
  },
  {
    id: 'bremerton',
    name: 'Bremerton',
    url: 'https://cdn.jsdelivr.net/gh/Eikanya/Live2d-model/%E7%A2%A7%E8%93%9D%E8%88%AA%E7%BA%BF%20Azue%20Lane/Azue%20Lane(JP)/bulaimodun_2/bulaimodun_2.model3.json',
    image: 'https://raw.githubusercontent.com/waifuai/waifu-companion/main/app/assets/20.png',
    series: 'Azur Lane',
    description: 'High-energy, empathetic listener and natural conversationalist.',
  },
  {
    id: 'ak12',
    name: 'AK-12',
    url: 'https://cdn.jsdelivr.net/gh/Eikanya/Live2d-model/%E5%B0%91%E5%A5%B3%E6%AC%A1%E5%85%83/106/c_9002.model3.json',
    image: 'https://raw.githubusercontent.com/waifuai/waifu-companion/main/app/assets/25.png',
    series: 'Girls Frontline',
    description: 'Cool-headed tactical android with an enigmatic closed-eye smile.',
  },
  {
    id: 'an94',
    name: 'AN-94',
    url: 'https://cdn.jsdelivr.net/gh/Eikanya/Live2d-model/%E5%B0%91%E5%A5%B3%E6%AC%A1%E5%85%83/105/c_9001.model3.json',
    image: 'https://raw.githubusercontent.com/waifuai/waifu-companion/main/app/assets/26.png',
    series: 'Girls Frontline',
    description: 'Quiet, earnest doll with deep loyalty and disciplined focus.',
  },
  {
    id: 'platelet',
    name: 'Platelet',
    url: 'https://cdn.jsdelivr.net/gh/Eikanya/Live2d-model/%E5%B0%91%E5%A5%B3%E6%AC%A1%E5%85%83/090/c_8005.model3.json',
    image: 'https://raw.githubusercontent.com/waifuai/waifu-companion/main/app/assets/38.png',
    series: 'Cells at Work',
    description: 'Hardworking, cheerful little helper ready to encourage your daily tasks!',
  },
];

export const DEFAULT_MODEL = WAIFU_MODELS[0];
