#version 300 es

precision highp float;
precision highp int;
precision highp sampler2D;

in vec3 vGenerated;

uniform sampler2D uImage_0;

struct HorizonPalette {
  vec4 shadowColor;
  vec4 midLowColor;
  vec4 midHighColor;
  vec4 highlightColor;
};

const HorizonPalette materialDefaultPalette = HorizonPalette(
  vec4(0.48958295583724976, 0.5062166452407837, 1.0, 1.0),
  vec4(0.5075743198394775, 0.6806396245956421, 1.0, 1.0),
  vec4(1.0, 1.0, 1.0, 1.0),
  vec4(0.8022463321685791, 0.8336243629455566, 1.0, 1.0)
);
const HorizonPalette materialBluePalette = HorizonPalette(
  vec4(0.0, 0.182326898, 0.776186228, 1.0),
  vec4(0.401119828, 0.753617108, 1.0, 1.0),
  vec4(1.0, 1.0, 1.0, 1.0),
  vec4(0.643137276, 0.80392158, 0.984313786, 1.0)
);
const HorizonPalette materialGreenPalette = HorizonPalette(
  vec4(0.0, 0.627581179, 0.131065607, 1.0),
  vec4(0.482586682, 0.819607854, 0.646261632, 1.0),
  vec4(1.0, 1.0, 1.0, 1.0),
  vec4(0.760784388, 0.917647064, 0.807843208, 1.0)
);
const HorizonPalette materialYellowPalette = HorizonPalette(
  vec4(1.0, 0.615798414, 0.0, 1.0),
  vec4(1.0, 0.896790802, 0.285905391, 1.0),
  vec4(1.0, 1.0, 1.0, 1.0),
  vec4(0.992156863, 0.894745171, 0.617015302, 1.0)
);
const HorizonPalette materialPinkPalette = HorizonPalette(
  vec4(0.941176474, 0.466666669, 0.686274529, 1.0),
  vec4(0.984313726, 0.749019623, 0.843137264, 1.0),
  vec4(1.0, 1.0, 1.0, 1.0),
  vec4(0.988235295, 0.896634519, 0.934801519, 1.0)
);
const HorizonPalette materialOrangePalette = HorizonPalette(
  vec4(0.933333337, 0.42786175, 0.12191844, 1.0),
  vec4(1.0, 0.727038801, 0.307055056, 1.0),
  vec4(1.0, 1.0, 1.0, 1.0),
  vec4(1.0, 0.913937926, 0.745554626, 1.0)
);
const HorizonPalette materialPurplePalette = HorizonPalette(
  vec4(0.53725493, 0.321568638, 0.933333337, 1.0),
  vec4(0.663499951, 0.613026738, 1.0, 1.0),
  vec4(1.0, 1.0, 1.0, 1.0),
  vec4(0.920169115, 0.883867264, 0.988235295, 1.0)
);

// Palettes derived for Willow's workspace colours. Every one of these is the
// measured workspace-blue -> materialDefaultPalette transform applied to its own
// swatch, so each stands in the same perceptual relationship to its swatch that the
// orb's current blue stands in to `#3b82f6`. See `orb-palette.ts` for the
// measurement and `voice-orb-palette.test.mjs`, which re-derives these numbers and
// fails if they drift. Workspace blue is absent on purpose: it uses
// materialDefaultPalette, which it already matches exactly.
const HorizonPalette workspaceGreenPalette = HorizonPalette(
  vec4(0.28638262624566163, 0.5452024905933573, 0.46599409914208917, 1.0),
  vec4(0.5180876142161649, 0.6568346316256439, 0.5618436134281265, 1.0),
  vec4(1.0, 1.0, 1.0, 1.0),
  vec4(0.753035277458444, 0.8320069719704309, 0.800192378940683, 1.0)
);
const HorizonPalette workspacePinkPalette = HorizonPalette(
  vec4(1.0, 0.34118997869513573, 0.46490911260985607, 1.0),
  vec4(0.9894626511975045, 0.5484021369271269, 0.7181493103651085, 1.0),
  vec4(1.0, 1.0, 1.0, 1.0),
  vec4(1.0, 0.7976432194972878, 0.8190122496394945, 1.0)
);
const HorizonPalette workspaceYellowPalette = HorizonPalette(
  vec4(0.8257334152406405, 0.7824177324060113, 0.2107328467274618, 1.0),
  vec4(0.9423333685781136, 0.811038081720388, 0.4831518462450169, 1.0),
  vec4(1.0, 1.0, 1.0, 1.0),
  vec4(0.9375869169168376, 0.9234424515355211, 0.7710733152303008, 1.0)
);
const HorizonPalette workspaceOrangePalette = HorizonPalette(
  vec4(0.9262761638777691, 0.5681750450947537, 0.0, 1.0),
  vec4(1.0, 0.6552118258681787, 0.46018287887375603, 1.0),
  vec4(1.0, 1.0, 1.0, 1.0),
  vec4(0.9889729582824206, 0.8489665066945756, 0.7205450785523978, 1.0)
);

HorizonPalette materialPaletteForIndex(uint paletteIndex) {
  switch (paletteIndex) {
    case 7u:
      return workspaceGreenPalette;
    case 8u:
      return workspacePinkPalette;
    case 9u:
      return workspaceYellowPalette;
    case 10u:
      return workspaceOrangePalette;
    case 1u:
      return materialBluePalette;
    case 2u:
      return materialGreenPalette;
    case 3u:
      return materialYellowPalette;
    case 4u:
      return materialPinkPalette;
    case 5u:
      return materialOrangePalette;
    case 6u:
      return materialPurplePalette;
    default:
      return materialDefaultPalette;
  }
}

const float materialMidLowRampStart = 0.3363637626171112;
const float materialMidLowRampEnd = 0.6286364793777466;
const float materialMidHighRampStart = 0.37727272510528564;
const float materialMidHighRampEnd = 0.5586364269256592;
const float materialHighlightRampStart = 0.1272730678319931;
const float materialHighlightRampEnd = 0.6200000047683716;

layout(std140) uniform HorizonUniformsObject {
  float waveFrame;
  float baseShaderFrame;
  float waveAmplitude;
  float textureFlowFrame;
  float textureEdgeWarp;
  float listeningTextureNoiseScale;
  vec2 speakingWatercolorOffset0;
  vec2 speakingWatercolorOffset1;
  vec2 speakingWatercolorOffset2;
  uint paletteIndex;
} ubo;

#define uWaveFrame ubo.waveFrame
#define uBaseShaderFrame ubo.baseShaderFrame
#define uWaveAmplitude ubo.waveAmplitude
#define uTextureFlowFrame ubo.textureFlowFrame
#define uTextureEdgeWarp ubo.textureEdgeWarp
#define uListeningTextureNoiseScale ubo.listeningTextureNoiseScale
#define uSpeakingWatercolorOffset0 ubo.speakingWatercolorOffset0
#define uSpeakingWatercolorOffset1 ubo.speakingWatercolorOffset1
#define uSpeakingWatercolorOffset2 ubo.speakingWatercolorOffset2
#define uPaletteIndex ubo.paletteIndex

out vec4 fragColor;

vec3 rotateX(vec3 value, float angle) {
  float c = cos(angle);
  float s = sin(angle);
  return vec3(value.x, c * value.y - s * value.z, s * value.y + c * value.z);
}

vec3 rotateY(vec3 value, float angle) {
  float c = cos(angle);
  float s = sin(angle);
  return vec3(c * value.x + s * value.z, value.y, -s * value.x + c * value.z);
}

vec3 rotateZ(vec3 value, float angle) {
  float c = cos(angle);
  float s = sin(angle);
  return vec3(c * value.x - s * value.y, s * value.x + c * value.y, value.z);
}

vec3 rotateEulerXYZ(vec3 value, vec3 rotation) {
  vec3 transformed = rotateX(value, rotation.x);
  transformed = rotateY(transformed, rotation.y);
  transformed = rotateZ(transformed, rotation.z);
  return transformed;
}

vec3 mappingPoint(vec3 value, vec3 location, vec3 rotation, vec3 scale) {
  return rotateEulerXYZ(value * scale, rotation) + location;
}

float hash2ToFloat(vec2 value) {
  return fract(sin(dot(value, vec2(127.1, 311.7))) * 43758.5453);
}

vec2 hash2ToVec2(vec2 value) {
  return vec2(
    hash2ToFloat(value),
    hash2ToFloat(value + vec2(19.19, 73.73))
  );
}

float valueNoise2(vec2 value) {
  vec2 cell = floor(value);
  vec2 fraction = fract(value);
  vec2 curve = fraction * fraction * (3.0 - 2.0 * fraction);
  float lower = mix(
    hash2ToFloat(cell),
    hash2ToFloat(cell + vec2(1.0, 0.0)),
    curve.x
  );
  float upper = mix(
    hash2ToFloat(cell + vec2(0.0, 1.0)),
    hash2ToFloat(cell + vec2(1.0, 1.0)),
    curve.x
  );
  return mix(lower, upper, curve.y);
}

float noiseFbm2(vec2 value, float roughness, float lacunarity) {
  float firstOctave = valueNoise2(value);
  float secondOctave = valueNoise2(value * lacunarity + vec2(17.17, 31.31));
  float thirdOctave = valueNoise2(
    value * lacunarity * lacunarity + vec2(47.47, 11.11)
  );
  float secondAmplitude = roughness;
  float thirdAmplitude = roughness * roughness;
  return (
    firstOctave +
    secondOctave * secondAmplitude +
    thirdOctave * thirdAmplitude
  ) / (1.0 + secondAmplitude + thirdAmplitude);
}

vec3 noiseColor4Detail2Normalized(
  vec3 coordinate,
  float w,
  float scale,
  float roughness,
  float lacunarity
) {
  vec2 point = coordinate.xy * scale;
  float time = w * scale;
  return vec3(
    noiseFbm2(point + vec2(time * 0.17, time * 0.11), roughness, lacunarity),
    noiseFbm2(
      point + vec2(41.41 - time * 0.13, 17.17 + time * 0.19),
      roughness,
      lacunarity
    ),
    noiseFbm2(
      point + vec2(23.23 + time * 0.07, 59.59 - time * 0.23),
      roughness,
      lacunarity
    )
  );
}

vec3 animatedColorRampWarp(vec3 coordinate, float frame) {
  vec2 point = coordinate.xy * 8.0;
  vec2 cell = floor(point);
  vec2 localPosition = fract(point);
  vec2 nearestPosition = vec2(0.0);
  float nearestDistance = 3.402823466e+38;
  float animationPhase = frame * 2.0 * 3.14159265 / 240.0;

  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 cellOffset = vec2(float(x), float(y));
      vec2 randomPosition = hash2ToVec2(cell + cellOffset);
      vec2 animatedPosition = cellOffset +
        randomPosition * 0.7185189723968506 +
        sin(vec2(animationPhase) + randomPosition * 6.2831853) * 0.04;
      vec2 delta = animatedPosition - localPosition;
      float distanceSquared = dot(delta, delta);

      if (distanceSquared < nearestDistance) {
        nearestDistance = distanceSquared;
        nearestPosition = animatedPosition;
      }
    }
  }

  vec3 voronoiPosition = vec3((nearestPosition + cell) / 8.0, coordinate.z);
  vec3 continuousWarp =
    (coordinate - vec3(0.5)) * 0.25999999046325684;
  vec3 cellularWarp = (voronoiPosition - coordinate) * 0.06;
  return continuousWarp + cellularWarp;
}

vec4 ramp_color_ramp_006(float fac) {
  if (fac <= materialHighlightRampStart) {
    return vec4(1.0, 1.0, 1.0, 1.0);
  }
  if (fac <= materialHighlightRampEnd) {
    float t = clamp((fac - materialHighlightRampStart) / max(materialHighlightRampEnd - materialHighlightRampStart, 0.000001), 0.0, 1.0);
    t = t * t * (3.0 - 2.0 * t);
    return mix(vec4(1.0, 1.0, 1.0, 1.0), vec4(0.0, 0.0, 0.0, 1.0), t);
  }
  return vec4(0.0, 0.0, 0.0, 1.0);
}

vec4 ramp_color_ramp_005(float fac) {
  if (fac <= materialMidHighRampStart) {
    return vec4(1.0, 1.0, 1.0, 1.0);
  }
  if (fac <= materialMidHighRampEnd) {
    float t = clamp((fac - materialMidHighRampStart) / max(materialMidHighRampEnd - materialMidHighRampStart, 0.000001), 0.0, 1.0);
    t = t * t * (3.0 - 2.0 * t);
    return mix(vec4(1.0, 1.0, 1.0, 1.0), vec4(0.0, 0.0, 0.0, 1.0), t);
  }
  return vec4(0.0, 0.0, 0.0, 1.0);
}

vec4 ramp_color_ramp_009(float fac) {
  if (fac <= materialMidLowRampStart) {
    return vec4(1.0, 1.0, 1.0, 1.0);
  }
  if (fac <= materialMidLowRampEnd) {
    float t = clamp((fac - materialMidLowRampStart) / max(materialMidLowRampEnd - materialMidLowRampStart, 0.000001), 0.0, 1.0);
    t = t * t * (3.0 - 2.0 * t);
    return mix(vec4(1.0, 1.0, 1.0, 1.0), vec4(0.0, 0.0, 0.0, 1.0), t);
  }
  return vec4(0.0, 0.0, 0.0, 1.0);
}

vec4 ramp_color_ramp_007(float fac) {
  if (fac <= 0.0) {
    return vec4(1.0, 1.0, 1.0, 1.0);
  }
  if (fac <= 1.0) {
    return vec4(1.0, 1.0, 1.0, 1.0);
  }
  return vec4(0.0, 0.0, 0.0, 1.0);
}

void main() {
  HorizonPalette materialPalette = materialPaletteForIndex(uPaletteIndex);
  vec4 materialShadowColor = materialPalette.shadowColor;
  vec4 materialMidLowColor = materialPalette.midLowColor;
  vec4 materialMidHighColor = materialPalette.midHighColor;
  vec4 materialHighlightColor = materialPalette.highlightColor;
  float frame = uBaseShaderFrame;
  float waveFrame = uWaveFrame;
  float textureFlowFrame = uTextureFlowFrame;
  
  
  vec3 scaledGenerated = vGenerated;
  vec3 n_texture_coordinate_001_generated = scaledGenerated;
vec3 n_mapping_003_vector = mappingPoint(n_texture_coordinate_001_generated, vec3(0.0, -0.14000000059604645, 0.0), vec3(0.0, 0.0, 0.0), vec3(1.0, 1.0, 1.0));
  vec2 textureEdgeCentered = scaledGenerated.xy - vec2(0.5);
  float textureEdgeRadius = length(textureEdgeCentered);
  float textureEdgeWeight = smoothstep(0.015, 0.44, textureEdgeRadius);
  vec2 textureEdgeDirection = textureEdgeRadius > 0.000001
    ? textureEdgeCentered / textureEdgeRadius
    : vec2(0.0);
  n_mapping_003_vector.xy += textureEdgeDirection * textureEdgeWeight * uTextureEdgeWarp;
float n_value_001_value = waveFrame / 100.0;
vec3 n_noise_texture_009_color = noiseColor4Detail2Normalized(n_mapping_003_vector, n_value_001_value, 1.0, 0.4000000059604645, 2.0);
vec3 n_vector_math_015_vector = n_noise_texture_009_color - vec3(0.5, 0.5, 0.5);
float n_value_003_value = (0.800000011920929) * uWaveAmplitude;
vec3 n_vector_math_016_vector = n_vector_math_015_vector * n_value_003_value;
vec3 n_vector_math_020_vector = n_mapping_003_vector + n_vector_math_016_vector;
vec3 n_noise_texture_color = noiseColor4Detail2Normalized(n_vector_math_020_vector, textureFlowFrame / 10.0, 4000.0, 0.5, 2.0);
vec3 n_vector_math_026_vector = (n_noise_texture_color - vec3(0.5, 0.5, 0.5)) * uListeningTextureNoiseScale;
vec3 n_vector_math_028_vector = n_vector_math_026_vector * 0.05999999865889549;
float n_value_value = 0.800000011920929;
vec3 n_vector_math_004_vector = n_vector_math_020_vector * n_value_value;
vec3 n_vector_math_010_vector = n_vector_math_028_vector + n_vector_math_004_vector;
  n_vector_math_010_vector.xy += uSpeakingWatercolorOffset0;
vec4 n_image_texture_004_color = textureGrad(uImage_0, (n_vector_math_010_vector).xy, dFdx((n_vector_math_010_vector).xy) * (1.0 / 1.5), dFdy((n_vector_math_010_vector).xy) * (1.0 / 1.5));
float n_math_002_value = (n_image_texture_004_color).r - 0.5;
vec3 n_vector_math_005_vector = n_vector_math_004_vector;
vec3 n_vector_math_013_vector = n_vector_math_028_vector + n_vector_math_005_vector;
float n_math_004_value = 1.0 - (n_vector_math_013_vector).y;
vec3 n_combine_xyz_005_vector = vec3((n_vector_math_013_vector).x, n_math_004_value, 0.0);
  n_combine_xyz_005_vector.xy += uSpeakingWatercolorOffset0;
vec4 n_image_texture_005_color = textureGrad(uImage_0, (n_combine_xyz_005_vector).xy, dFdx((n_combine_xyz_005_vector).xy) * (1.0 / 1.5), dFdy((n_combine_xyz_005_vector).xy) * (1.0 / 1.5));
float n_math_005_value = (n_image_texture_005_color).g - 0.5;
float baseShaderFrameBlend120 =
  clamp(0.5 - 0.5*cos(frame * 2.0 * 3.14159265 / 120.0), 0.0, 1.0);
float n_mix_012_result_float = mix(n_math_002_value, n_math_005_value, baseShaderFrameBlend120);
float n_value_002_value = 0.2 - 0.06*cos((frame - 1.0) * 2.0 * 3.14159265 / 120.0);
float n_math_003_value = n_mix_012_result_float * n_value_002_value;
vec3 n_combine_xyz_004_vector = vec3(n_math_003_value, n_math_003_value, 0.0);
vec3 n_vector_math_023_vector = animatedColorRampWarp(n_vector_math_020_vector, frame);
vec3 n_vector_math_vector = n_combine_xyz_004_vector + n_vector_math_023_vector;
vec3 n_vector_math_001_vector = n_vector_math_020_vector + n_vector_math_vector;
vec3 n_mapping_006_vector = mappingPoint(n_vector_math_001_vector, vec3(0.0, 0.559999942779541, 0.0), vec3(0.0, 0.7853981852531433, 0.0), vec3(1.0, 1.0, 1.0));
vec4 n_color_ramp_006_color = ramp_color_ramp_006(((n_mapping_006_vector).x + (n_mapping_006_vector).y + (n_mapping_006_vector).z) / 3.0);
float n_value_005_value = 0.800000011920929;
vec3 n_mapping_vector = mappingPoint(n_vector_math_020_vector, vec3(0.03999999910593033, 0.019999999552965164, 0.0), vec3(0.0, 0.0, 0.0), vec3(n_value_005_value));
vec3 n_vector_math_021_vector = n_vector_math_028_vector + n_mapping_vector;
  n_vector_math_021_vector.xy += uSpeakingWatercolorOffset1;
vec4 n_image_texture_006_color = textureGrad(uImage_0, (n_vector_math_021_vector).xy, dFdx((n_vector_math_021_vector).xy) * (1.0 / 1.5), dFdy((n_vector_math_021_vector).xy) * (1.0 / 1.5));
float n_math_006_value = (n_image_texture_006_color).r - 0.5;
vec3 n_mapping_001_vector = mappingPoint(n_vector_math_020_vector, vec3(-0.03999999910593033, -0.019999999552965164, 0.0), vec3(0.0, 0.0, 0.0), vec3(n_value_005_value));
vec3 n_vector_math_024_vector = n_vector_math_028_vector + n_mapping_001_vector;
float n_math_008_value = 1.0 - (n_vector_math_024_vector).y;
vec3 n_combine_xyz_007_vector = vec3((n_vector_math_024_vector).x, n_math_008_value, 0.0);
  n_combine_xyz_007_vector.xy += uSpeakingWatercolorOffset1;
vec4 n_image_texture_007_color = textureGrad(uImage_0, (n_combine_xyz_007_vector).xy, dFdx((n_combine_xyz_007_vector).xy) * (1.0 / 1.5), dFdy((n_combine_xyz_007_vector).xy) * (1.0 / 1.5));
float n_math_009_value = (n_image_texture_007_color).g - 0.5;
float n_mix_013_result_float = mix(n_math_006_value, n_math_009_value, baseShaderFrameBlend120);
float n_value_004_value = 0.2 - 0.06*cos((frame - 1.0) * 2.0 * 3.14159265 / 80.0);
float n_math_007_value = n_mix_013_result_float * n_value_004_value;
vec3 n_combine_xyz_006_vector = vec3(n_math_007_value, n_math_007_value, 0.0);
vec3 n_vector_math_003_vector = n_combine_xyz_006_vector + n_vector_math_023_vector;
vec3 n_vector_math_002_vector = n_vector_math_020_vector + n_vector_math_003_vector;
vec3 n_mapping_004_vector = mappingPoint(n_vector_math_002_vector, vec3(0.0, 0.25999999046325684, 0.0), vec3(0.0, 0.7853981852531433, 0.0), vec3(1.0, 1.0, 1.0));
vec4 n_color_ramp_005_color = ramp_color_ramp_005(((n_mapping_004_vector).x + (n_mapping_004_vector).y + (n_mapping_004_vector).z) / 3.0);
vec3 n_texture_coordinate_002_generated = scaledGenerated;
vec3 n_mapping_007_vector = mappingPoint(n_texture_coordinate_002_generated, vec3(-0.3199999928474426, 0.0, 0.0), vec3(0.0, 0.0, -1.5707963705062866), vec3(1.0, 1.0, 1.0));
float n_gradient_texture_clamped = clamp((n_mapping_007_vector).x, 0.0, 1.0);
float n_gradient_texture_fac = n_gradient_texture_clamped * n_gradient_texture_clamped
  * (3.0 - 2.0 * n_gradient_texture_clamped);
float n_value_007_value = 0.800000011920929;
vec3 n_mapping_002_vector = mappingPoint(n_vector_math_020_vector, vec3(-0.07999999821186066, -0.03999999910593033, 0.0), vec3(0.0, 0.0, 0.0), vec3(n_value_007_value));
vec3 n_vector_math_027_vector = n_vector_math_028_vector + n_mapping_002_vector;
  n_vector_math_027_vector.xy += uSpeakingWatercolorOffset2;
vec4 n_image_texture_008_color = textureGrad(uImage_0, (n_vector_math_027_vector).xy, dFdx((n_vector_math_027_vector).xy) * (1.0 / 1.5), dFdy((n_vector_math_027_vector).xy) * (1.0 / 1.5));
vec4 n_mix_002_result_color = mix(n_image_texture_008_color, vec4(1.0, 1.0, 1.0, 1.0), clamp(((vec4(vec3(n_gradient_texture_fac), 1.0)).r + (vec4(vec3(n_gradient_texture_fac), 1.0)).g + (vec4(vec3(n_gradient_texture_fac), 1.0)).b) / 3.0, 0.0, 1.0));
float n_math_010_value = (n_mix_002_result_color).r - 0.5;
vec3 n_mapping_005_vector = mappingPoint(n_vector_math_020_vector, vec3(-0.9599999189376831, 0.05999999865889549, 0.0), vec3(0.0, 0.0, 0.0), vec3(n_value_007_value));
vec3 n_vector_math_030_vector = n_vector_math_028_vector + n_mapping_005_vector;
float n_math_012_value = 1.0 - (n_vector_math_030_vector).y;
vec3 n_combine_xyz_009_vector = vec3((n_vector_math_030_vector).x, n_math_012_value, 0.0);
  n_combine_xyz_009_vector.xy += uSpeakingWatercolorOffset2;
vec4 n_image_texture_009_color = textureGrad(uImage_0, (n_combine_xyz_009_vector).xy, dFdx((n_combine_xyz_009_vector).xy) * (1.0 / 1.5), dFdy((n_combine_xyz_009_vector).xy) * (1.0 / 1.5));
vec4 n_mix_001_result_color = mix(n_image_texture_009_color, vec4(1.0, 1.0, 1.0, 1.0), clamp(((vec4(vec3(n_gradient_texture_fac), 1.0)).r + (vec4(vec3(n_gradient_texture_fac), 1.0)).g + (vec4(vec3(n_gradient_texture_fac), 1.0)).b) / 3.0, 0.0, 1.0));
float n_math_013_value = (n_mix_001_result_color).g - 0.5;
float n_mix_014_result_float = mix(n_math_010_value, n_math_013_value, baseShaderFrameBlend120);
float n_value_006_value = 0.14 - 0.06*cos((frame - 1.0) * 2.0 * 3.14159265 / 100.0);
float n_math_011_value = n_mix_014_result_float * n_value_006_value;
vec3 n_combine_xyz_008_vector = vec3(n_math_011_value, n_math_011_value, 0.0);
vec3 n_vector_math_007_vector = n_combine_xyz_008_vector + n_vector_math_023_vector;
vec3 n_vector_math_006_vector = n_vector_math_020_vector + n_vector_math_007_vector;
vec3 n_mapping_009_vector = mappingPoint(n_vector_math_006_vector, vec3(0.0, 0.12000000476837158, 0.0), vec3(0.0, 0.7853981852531433, 0.0), vec3(1.0, 1.0, 1.0));
vec4 n_color_ramp_009_color = ramp_color_ramp_009(((n_mapping_009_vector).x + (n_mapping_009_vector).y + (n_mapping_009_vector).z) / 3.0);
vec3 n_texture_coordinate_generated = scaledGenerated;
vec3 n_mapping_008_vector = mappingPoint(n_texture_coordinate_generated, vec3(0.0, 0.0, 0.0), vec3(0.0, 0.0, 0.0), vec3(1.0, 1.0, 1.0));
vec4 n_color_ramp_007_color = ramp_color_ramp_007(((n_mapping_008_vector).x + (n_mapping_008_vector).y + (n_mapping_008_vector).z) / 3.0);
vec4 n_mix_010_result_color = mix(vec4(0.0, 0.0, 0.0, 1.0), materialShadowColor, clamp(((n_color_ramp_007_color).r + (n_color_ramp_007_color).g + (n_color_ramp_007_color).b) / 3.0, 0.0, 1.0));
vec4 n_mix_011_result_color = mix(n_mix_010_result_color, materialMidLowColor, clamp(((n_color_ramp_009_color).r + (n_color_ramp_009_color).g + (n_color_ramp_009_color).b) / 3.0, 0.0, 1.0));
vec4 n_mix_008_result_color = mix(n_mix_011_result_color, materialMidHighColor, clamp(((n_color_ramp_005_color).r + (n_color_ramp_005_color).g + (n_color_ramp_005_color).b) / 3.0, 0.0, 1.0));
vec4 n_mix_009_result_color = mix(n_mix_008_result_color, materialHighlightColor, clamp(((n_color_ramp_006_color).r + (n_color_ramp_006_color).g + (n_color_ramp_006_color).b) / 3.0, 0.0, 1.0));
vec4 materialColor = vec4((n_mix_009_result_color).rgb, 1.0);
  fragColor = materialColor;
}