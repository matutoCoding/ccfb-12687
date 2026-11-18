// 全部 GLSL ES 3.00 着色器：吸色 / 各向异性扩散 / 氧化固着 / 合成 / 疵点度量 / 整匹平铺
import { fullscreenVs } from './gl-helpers';

export const VERT = fullscreenVs();

/** 通用公共头：纹理与采样函数 */
const COMMON = `
precision highp float;
in vec2 v_uv;
out vec4 outColor;
`;

/**
 * 吸色 pass
 * u_state: r=已固着吸色量 g=游离染液量 b=各道累计吸色(本道) a=预留
 * u_tie / u_wax: r=进色率(1=自由进色 0=扎死/封蜡)
 * u_orient: rg=纤维方向(向量) b=疏密
 */
export const UPTAKE_FS = `#version 300 es
${COMMON}
uniform sampler2D u_state;
uniform sampler2D u_tie;
uniform sampler2D u_wax;
uniform float u_uptake;      // 坯布吸色速率 * 浓度归一系数
uniform float u_dipTime;     // 浸染时长归一
uniform float u_liquor;      // 浴比影响（浴比越小染液越"稠"，吸色略高）
void main(){
  vec4 st = texture(u_state, v_uv);
  float tieA = texture(u_tie, v_uv).r;
  float waxA = texture(u_wax, v_uv).r;
  float access = tieA * waxA;
  float bath = u_uptake * u_dipTime * (1.0 + 0.15 / max(u_liquor, 1.0) * 5.0);
  // 游离染液先进入布面（受进色率限制），扎死/封蜡区进色趋近 0
  float incoming = bath * access;
  float mobile = st.g + incoming;
  outColor = vec4(st.r, mobile, st.b, 1.0);
}`;

/**
 * 各向异性毛细扩散（半拉格朗日回采 + 沿纤维方向扩散）
 */
export const DIFFUSE_FS = `#version 300 es
${COMMON}
uniform sampler2D u_state;
uniform sampler2D u_orient;
uniform float u_cap;       // 毛细扩散系数（已按分辨率折算）
uniform vec2 u_texel;      // 1/尺寸
void main(){
  vec4 st = texture(u_state, v_uv);
  vec3 o = texture(u_orient, v_uv).rgb;
  vec2 dir = normalize(o.rg * 2.0 - 1.0 + vec2(1e-5));
  float density = o.b;
  // 沿纤维方向扩散强，垂直方向弱；疏密越大孔隙越小扩散越慢
  float k = u_cap * (1.15 - density * 0.6);
  vec2 along = dir * u_texel * k;
  vec2 across = vec2(-dir.y, dir.x) * u_texel * k * 0.35;
  float c = st.g;
  float cA = texture(u_state, v_uv + along).g;
  float cB = texture(u_state, v_uv - along).g;
  float cC = texture(u_state, v_uv + across).g;
  float cD = texture(u_state, v_uv - across).g;
  float lap = (cA + cB - 2.0 * c) + 0.35 * (cC + cD - 2.0 * c);
  float mobile = max(c + lap, 0.0);
  outColor = vec4(st.r, mobile, st.b, 1.0);
}`;

/**
 * 氧化固着：游离染液按氧化时长固着到纤维上
 */
export const FIXATE_FS = `#version 300 es
${COMMON}
uniform sampler2D u_state;
uniform sampler2D u_tie;
uniform float u_oxidize;   // 氧化时长归一 0..1
void main(){
  vec4 st = texture(u_state, v_uv);
  float tieA = texture(u_tie, v_uv).r;
  float fixNow = st.g * clamp(u_oxidize, 0.05, 1.0) * (0.35 + 0.65 * tieA);
  float fixedAmt = st.r + fixNow;
  float mobile = st.g - fixNow;
  outColor = vec4(fixedAmt, mobile, st.b + fixNow, 1.0);
}`;

/**
 * 合成成品色
 * u_state.r = 累计固着吸色量（可能 >1，多道叠加）
 */
export const COMPOSITE_FS = `#version 300 es
${COMMON}
uniform sampler2D u_state;
uniform sampler2D u_wax;
uniform sampler2D u_orient;
uniform vec3 u_dyeRgb;      // 线性空间染液色
uniform vec3 u_clothRgb;    // 坯布本色（线性）
uniform float u_waxOn;      // 1=退蜡前 0=退蜡后
uniform float u_totalDips;
uniform float u_bleedSigma; // 毛边柔化
void main(){
  vec4 st = texture(u_state, v_uv);
  float absorb = st.r;
  // 蜡膜信息：r 进色率 g 厚度 b 脆度 a 浮色积累
  vec4 wax = texture(u_wax, v_uv);
  vec3 orient = texture(u_orient, v_uv).rgb;
  // 减法混色（sRGB 近似感知空间）：吸色深度越深，反射色从坯布本白向染液本色收敛
  float t = 1.0 - exp(-absorb * 4.6);
  vec3 color = mix(u_clothRgb, u_dyeRgb, t);
  color = clamp(color, 0.0, 1.0);

  // 织纹发色细节：纤维方向上的细微明暗
  float weave = 1.0 + 0.035 * sin(v_uv.x * 900.0) * sin(v_uv.y * 820.0)
                    * (0.6 + orient.b);
  color *= weave;

  if (u_waxOn > 0.5) {
    // 封蜡区：蜡膜覆盖，呈暖白蜡色 + 吸附浮色
    float waxCover = smoothstep(0.02, 0.35, 1.0 - wax.r);
    vec3 waxColor = vec3(0.93, 0.88, 0.76);
    float floatingTint = wax.a * 0.5;
    waxColor = mix(waxColor, u_dyeRgb * 1.6, floatingTint);
    color = mix(color, waxColor, waxCover * 0.92);
  } else {
    // 退蜡后：蜡边深色蜡痕（厚度梯度大的一圈）
    vec2 t = vec2(1.0 / 640.0);
    float h = wax.g;
    float grad = length(vec2(
      texture(u_wax, v_uv + vec2(t.x, 0.0)).g - texture(u_wax, v_uv - vec2(t.x, 0.0)).g,
      texture(u_wax, v_uv + vec2(0.0, t.y)).g - texture(u_wax, v_uv - vec2(0.0, t.y)).g
    ));
    float ring = smoothstep(0.06, 0.35, grad) * smoothstep(0.05, 0.4, h);
    color *= 1.0 - ring * 0.45;
    // 薄蜡半透造成的毛边：进色率处于中间地带的柔化残留
    float feather = smoothstep(0.15, 0.95, wax.r) * (1.0 - smoothstep(0.95, 1.0, wax.r));
    color = mix(color, color * vec3(0.92, 0.95, 1.02), feather * 0.5);
  }
  // 直接输出 sRGB 计算结果（画布 2D 回读按 sRGB 解释，浮点 FBO 不再二次编码）
  outColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}`;

/**
 * 疵点度量 pass（低分辨率回读 CPU 分析）
 * 输出 r=吸色量 g=局部水平梯度均值(色花/色档) b=左右不对称度(阴阳面)
 */
export const METRIC_FS = `#version 300 es
${COMMON}
uniform sampler2D u_state;
uniform vec2 u_texel;
void main(){
  float c = texture(u_state, v_uv).r;
  float gx = 0.0;
  float gy = 0.0;
  for (int i = 1; i <= 4; i++) {
    float fi = float(i);
    gx += abs(texture(u_state, v_uv + vec2(u_texel.x * fi, 0.0)).r
            - texture(u_state, v_uv - vec2(u_texel.x * fi, 0.0)).r);
    gy += abs(texture(u_state, v_uv + vec2(0.0, u_texel.y * fi)).r
            - texture(u_state, v_uv - vec2(0.0, u_texel.y * fi)).r);
  }
  // 阴阳面：与水平镜像点的差异
  float mirror = texture(u_state, vec2(1.0 - v_uv.x, v_uv.y)).r;
  float asym = abs(c - mirror);
  outColor = vec4(c, gx * 0.25, gy * 0.25, asym);
}`;

/**
 * 整匹布平铺预览：四方连续 + 平接/跳接 + 卷曲
 */
export const PREVIEW_FS = `#version 300 es
${COMMON}
uniform sampler2D u_tile;
uniform vec2 u_repeat;
uniform float u_halfDrop;   // 0=平接 1=跳接(1/2 错位)
uniform float u_curl;       // 卷曲程度 0..1
uniform float u_time;
void main(){
  vec2 uv = v_uv;
  // 跳接：奇数行横向偏移半个单元
  float row = floor(uv.y * u_repeat.y);
  float shift = mod(row, 2.0) * 0.5 * u_halfDrop;
  vec2 tiled = fract(vec2(uv.x * u_repeat.x + shift, uv.y * u_repeat.y));
  // 卷曲：横向坐标做圆柱弯曲，模拟布卷收放
  float curl = u_curl * 0.5;
  float bend = sin(uv.x * 3.14159) * curl;
  vec3 col = texture(u_tile, tiled).rgb;
  float shade = 1.0 - bend * 0.55;
  // 卷边暗部
  float edge = smoothstep(0.0, 0.08, uv.x) * smoothstep(0.0, 0.08, 1.0 - uv.x);
  col *= shade * mix(0.55, 1.0, edge);
  outColor = vec4(col, 1.0);
}`;
