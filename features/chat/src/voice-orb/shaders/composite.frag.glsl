#version 300 es
precision highp float;
precision highp sampler2D;

in vec2 vSdfPosition;

uniform sampler2D uInteriorTexture;
uniform float uBaseShaderFrame;
uniform float uMicLevel;
uniform float uSurfaceScale;
uniform float uUserSpeakingScale;
uniform float uConnectionRevealAmount;
uniform float uPreConnectionDotVisibility;
uniform vec4 uPreConnectionDotColor;

out vec4 fragColor;

const float USER_SPEAKING_BASE_SCALE_REDUCTION = 0.14;
const float USER_SPEAKING_MIC_PULSE_SCALE = 0.08;
const float MIN_HORIZON_ORB_SCALE = 0.75;

const float PRE_CONNECTION_DOT_FRAME_RATE = 24.0;
const float PRE_CONNECTION_DOT_BASE_RADIUS = 0.1;
const float PRE_CONNECTION_DOT_RADIUS_PULSE_SCALE = 0.04;
const float PRE_CONNECTION_DOT_RADIUS_PERIOD_SECONDS = 0.7;

float preConnectionDotRadius(float frame) {
  float timeSeconds = frame / PRE_CONNECTION_DOT_FRAME_RATE;
  float pulse =
    sin(2.0 * 3.14159265 * timeSeconds / PRE_CONNECTION_DOT_RADIUS_PERIOD_SECONDS);

  return PRE_CONNECTION_DOT_BASE_RADIUS *
    (1.0 + PRE_CONNECTION_DOT_RADIUS_PULSE_SCALE * pulse);
}

float connectionRevealScale(float frame) {
  float revealAmount = clamp(uConnectionRevealAmount, 0.0, 1.0);
  float easedReveal = revealAmount * revealAmount * (3.0 - 2.0 * revealAmount);

  return mix(preConnectionDotRadius(frame), 1.0, easedReveal);
}

float horizonOrbScale(float frame) {
  float userSpeaking = clamp(uUserSpeakingScale, 0.0, 1.0);
  float micLevel = clamp(uMicLevel, 0.0, 1.0);
  float baseScale = 1.0 - userSpeaking * USER_SPEAKING_BASE_SCALE_REDUCTION;
  float pulseScale = userSpeaking * micLevel * USER_SPEAKING_MIC_PULSE_SCALE;
  float voiceScale = max(baseScale + pulseScale, MIN_HORIZON_ORB_SCALE);

  return voiceScale * uSurfaceScale * connectionRevealScale(frame);
}

vec4 renderPreConnectionDot(vec2 sdfPosition, float frame) {
  float dotDistance = length(sdfPosition) - preConnectionDotRadius(frame);
  
  float dotShape = 1.0 - step(0.0, dotDistance);

  return uPreConnectionDotColor * dotShape;
}

void main() {
  float frame = uBaseShaderFrame;

  
  if (uPreConnectionDotVisibility >= 1.0) {
    fragColor = renderPreConnectionDot(vSdfPosition, frame);
    return;
  }

  float orbScale = horizonOrbScale(frame);
  vec2 scaledSdfPosition = vSdfPosition / orbScale;
  float sdfDistance = length(scaledSdfPosition) - 1.0;
  float edgeWidth = max(fwidth(sdfDistance), 0.000001);

  if (sdfDistance >= edgeWidth * 2.0) {
    fragColor = vec4(0.0);
    return;
  }

  vec2 interiorUv = scaledSdfPosition * 0.5 + 0.5;
  vec3 interiorColor = texture(uInteriorTexture, interiorUv).rgb;
  float shape = 1.0 - smoothstep(
    -edgeWidth,
    edgeWidth,
    sdfDistance + edgeWidth * 0.5
  );

  
  
  fragColor = vec4(interiorColor * shape, shape);
}