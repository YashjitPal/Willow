import fs from 'fs';

const dataStr = fs.readFileSync('C:\\Users\\user\\.gemini\\antigravity\\brain\\a9f5404f-b0c1-4d29-84e3-f5bac91c73ad\\.system_generated\\steps\\1609\\output.txt', 'utf8');
const jsonStr = dataStr.substring(dataStr.indexOf('{"tag":'), dataStr.lastIndexOf('}') + 1);
const data = JSON.parse(jsonStr);

const simplify = (node) => {
  if (!node) return null;
  
  // if it's an icon, let's keep it minimal
  if (node.text === '[ICON]' || node.tag === 'SVG' || node.tag === 'svg') {
     return { type: 'icon', tag: node.tag, styles: node.styles };
  }
  
  const simplifiedChildren = (node.children || []).map(simplify).filter(Boolean);
  
  return {
    tag: node.tag,
    text: node.text,
    w: node.rect.w,
    h: node.rect.h,
    color: node.styles.color,
    bg: node.styles.bg,
    fontSize: node.styles.fontSize,
    fontWeight: node.styles.fontWeight,
    fontFamily: node.styles.fontFamily,
    padding: node.styles.padding,
    margin: node.styles.margin,
    display: node.styles.display,
    flexDir: node.styles.flexDir,
    gap: node.styles.gap,
    border: node.styles.border,
    radius: node.styles.radius,
    children: simplifiedChildren
  };
};

const simplified = simplify(data);
fs.writeFileSync('C:\\Users\\user\\.gemini\\antigravity\\brain\\a9f5404f-b0c1-4d29-84e3-f5bac91c73ad\\scratch\\simplified-gems.json', JSON.stringify(simplified, null, 2));
console.log('Done parsing.');
