#version 300 es
in vec2 aPosition;
in vec3 aGenerated;
out vec3 vGenerated;

void main() {
  vGenerated = aGenerated;
  gl_Position = vec4(aPosition, 0.0, 1.0);
}