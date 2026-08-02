// Image-editor annotations: the shape the viewer's draw/text/rect/select tools
// produce, and the system prompt that describes them to the image model.
//
// `buildAnnotationSystemPrompt` was defined inside MediaView's component body
// and read `annotations` from closure; it takes the list as an argument now.
// The `Annotation` interface moved with it — it was declared inside the
// component too, which put a type declaration in the middle of the hooks.

export interface Annotation {
  id: string;
  type: 'draw' | 'text' | 'rect' | 'select-box' | 'select-lasso';
  color: string;
  size: number;
  points?: { x: number; y: number }[];
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  text?: string;
}

/**
 * Describe what the user drew so the model treats the marks as guiding masks
 * rather than content to reproduce. Returns the generic instruction when there
 * are no annotations.
 */
export const buildAnnotationSystemPrompt = (annotations: Annotation[]) => {
  const segments: string[] = [];

  const drawAnns = annotations.filter(a => a.type === 'draw');
  const textAnns = annotations.filter(a => a.type === 'text');
  const rectAnns = annotations.filter(a => a.type === 'rect');
  const boxAnns = annotations.filter(a => a.type === 'select-box');
  const lassoAnns = annotations.filter(a => a.type === 'select-lasso');

  if (drawAnns.length > 0) {
    const colors = Array.from(new Set(drawAnns.map(a => a.color))).join(', ');
    segments.push(`The user used drawing/brush annotations to paint something on the screen with the color(s): ${colors}. Please generate and edit the image based on what the user has drawn.`);
  }

  if (textAnns.length > 0) {
    const colors = Array.from(new Set(textAnns.map(a => a.color))).join(', ');
    segments.push(`The user used the text option to write text on the screen in the color(s): ${colors}.`);
  }

  if (rectAnns.length > 0) {
    const colors = Array.from(new Set(rectAnns.map(a => a.color))).join(', ');
    segments.push(`The user drew a rectangle on the screen in the color(s): ${colors} to highlight a region.`);
  }

  if (boxAnns.length > 0) {
    segments.push(`The user used a select-box tool to target a rectangular area.`);
  }

  if (lassoAnns.length > 0) {
    segments.push(`The user used a lasso tool to select a custom region.`);
  }

  if (segments.length === 0) {
    return "The user is editing this image. Please edit the image to match the user's request.";
  }

  return `The user is editing this image. Details about the user's annotations/selections:\n${segments.join('\n')}\nModify the image based on these inputs and the user request. IMPORTANT: The user's drawings, selections, and annotations are guiding masks/inputs only. Do NOT include, reproduce, or show the actual drawn outlines, brush strokes, text annotations, colors, or selections themselves in the final generated image output.`;
};
