#version 300 es
in vec2 aPosition;
out vec2 vSdfPosition;

void main() {
  vSdfPosition = aPosition;
  gl_Position = vec4(aPosition, 0.0, 1.0);
}