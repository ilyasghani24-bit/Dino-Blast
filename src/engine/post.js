import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

// Grading pass runs in linear HDR before tone mapping: saturation, chromatic
// aberration, radial "impact" blur, flash, and vignette.
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uAberration: { value: 0.0 },
    uRadial: { value: 0.0 },
    uCenter: { value: new THREE.Vector2(0.5, 0.5) },
    uFlash: { value: 0.0 },
    uFlashColor: { value: new THREE.Color(1, 1, 1) },
    uSaturation: { value: 1.18 },
    uVignette: { value: 0.35 },
    uTint: { value: new THREE.Color(1, 1, 1) },
    uDesat: { value: 0.0 },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float uAberration, uRadial, uFlash, uSaturation, uVignette, uDesat;
    uniform vec2 uCenter;
    uniform vec3 uFlashColor, uTint;
    varying vec2 vUv;
    void main() {
      vec2 dir = vUv - uCenter;
      vec3 col;
      if (uRadial > 0.001) {
        col = vec3(0.0);
        for (int i = 0; i < 10; i++) {
          float k = float(i) / 9.0;
          col += texture2D(tDiffuse, uCenter + dir * (1.0 - uRadial * k)).rgb;
        }
        col /= 10.0;
      } else {
        col = texture2D(tDiffuse, vUv).rgb;
      }
      if (uAberration > 0.0001) {
        vec2 off = dir * uAberration;
        col.r = mix(col.r, texture2D(tDiffuse, vUv + off).r, 0.85);
        col.b = mix(col.b, texture2D(tDiffuse, vUv - off).b, 0.85);
      }
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(l), col, uSaturation * (1.0 - uDesat));
      col *= uTint;
      float v = 1.0 - smoothstep(0.25, 0.95, length(dir * vec2(1.0, 0.8)));
      col *= mix(1.0 - uVignette, 1.0, v);
      col = mix(col, uFlashColor * 2.0, uFlash);
      gl_FragColor = vec4(col, 1.0);
    }`,
};

export class Post {
  constructor(renderer, scene, camera, { samples = 4 } = {}) {
    this.renderer = renderer;
    const size = renderer.getSize(new THREE.Vector2());
    const pr = renderer.getPixelRatio();
    const rt = new THREE.WebGLRenderTarget(size.x * pr, size.y * pr, { type: THREE.HalfFloatType, samples });
    this.composer = new EffectComposer(renderer, rt);
    this.composer.addPass(new RenderPass(scene, camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.45, 0.5, 1.15);
    this.composer.addPass(this.bloom);
    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.grade);
    this.composer.addPass(new OutputPass());
    this.u = this.grade.uniforms;
    this.flash = 0;
    this.aberr = 0;
    this.radial = 0;
    this.baseBloom = 0.45;
    this.bloomKick = 0;
  }

  setSize(w, h) { this.composer.setSize(w, h); }

  kick({ flash = 0, aberration = 0, radial = 0, bloom = 0, color = null, center = null } = {}) {
    this.flash = Math.max(this.flash, flash);
    this.aberr = Math.max(this.aberr, aberration);
    this.radial = Math.max(this.radial, radial);
    this.bloomKick = Math.max(this.bloomKick, bloom);
    if (color) this.u.uFlashColor.value.set(color);
    if (center) this.u.uCenter.value.copy(center);
  }

  update(dt) {
    dt = Math.max(0, dt);
    const clamp = (v, hi) => Math.min(hi, Math.max(0, v));
    this.flash = clamp(this.flash - dt * 4, 1);
    this.aberr = clamp(this.aberr - dt * 0.05, 0.05);
    this.radial = clamp(this.radial - dt * 0.9, 0.5);
    this.bloomKick = clamp(this.bloomKick - dt * 2, 1.6);
    this.u.uFlash.value = this.flash * this.flash;
    this.u.uAberration.value = 0.0025 + this.aberr;
    this.u.uRadial.value = this.radial;
    this.bloom.strength = this.baseBloom + this.bloomKick;
    if (this.radial < 0.01) this.u.uCenter.value.lerp(new THREE.Vector2(0.5, 0.5), Math.min(1, dt * 3));
  }

  render(dt) { this.composer.render(dt); }
}
