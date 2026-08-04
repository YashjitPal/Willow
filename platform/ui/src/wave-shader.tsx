"use client"

import { useEffect, useRef } from "react"
import { STUDIO_SIDEBAR_COLLAPSED_WIDTH, STUDIO_SIDEBAR_EXPANDED_WIDTH } from '@willow/core/layout'

declare global {
  interface Window {
    THREE: any
  }
}

interface WaveShaderBackgroundProps {
  isSidebarCollapsed?: boolean;
}

export function WaveShaderBackground({ isSidebarCollapsed = false }: WaveShaderBackgroundProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const sceneRef = useRef<{
    renderer: any
    uniforms: any
    animationId: number | null
    initialized: boolean
    clock: any
  }>({
    renderer: null,
    uniforms: null,
    animationId: null,
    initialized: false,
    clock: null
  })

  // Calculate current sidebar width based on prop
  const currentSidebarWidth = isSidebarCollapsed ? STUDIO_SIDEBAR_COLLAPSED_WIDTH : STUDIO_SIDEBAR_EXPANDED_WIDTH;

  useEffect(() => {
    if (sceneRef.current.uniforms) {
      sceneRef.current.uniforms.uSidebarWidth.value = currentSidebarWidth;
    }
  }, [currentSidebarWidth]);

  useEffect(() => {
    if (window.THREE && containerRef.current && !sceneRef.current.initialized) {
      initThreeJS()
      return
    }

    const script = document.createElement("script")
    script.src = "https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"
    script.onload = () => {
      if (containerRef.current && window.THREE && !sceneRef.current.initialized) {
        initThreeJS()
      }
    }
    document.head.appendChild(script)

    return () => {
      if (sceneRef.current.animationId) {
        cancelAnimationFrame(sceneRef.current.animationId)
      }
      if (sceneRef.current.renderer) {
        sceneRef.current.renderer.dispose()
      }
    }
  }, [])

  const initThreeJS = () => {
    if (!containerRef.current || !window.THREE) return

    const THREE = window.THREE
    const container = containerRef.current
    
    // Initial sidebar width
    // Use the same width constants as the rendered studio sidebar.
    const initialSidebarWidth = isSidebarCollapsed ? STUDIO_SIDEBAR_COLLAPSED_WIDTH : STUDIO_SIDEBAR_EXPANDED_WIDTH;

    const scene = new THREE.Scene()
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
    
    // Alpha true for transparent background (shows container background)
    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true })
    renderer.setSize(container.clientWidth, container.clientHeight)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    
    container.innerHTML = ""
    container.appendChild(renderer.domElement)

    const vertexShader = `
        varying vec2 vUv;
        void main() {
            vUv = uv;
            gl_Position = vec4(position, 1.0);
        }
    `

    const fragmentShader = `
        uniform float uTime;
        uniform float uProgress;
        uniform vec2 uResolution;
        uniform float uSidebarWidth;
        
        uniform vec3 uColorTop;
        uniform vec3 uColorMid;
        uniform vec3 uColorBot;
        
        varying vec2 vUv;

        float hash(vec2 p) {
            p = fract(p * vec2(123.34, 456.21));
            p += dot(p, p + 45.32);
            return fract(p.x * p.y);
        }

        float noise(vec2 p) {
            vec2 i = floor(p);
            vec2 f = fract(p);
            f = f * f * (3.0 - 2.0 * f); 
            return mix(mix(hash(i + vec2(0.0, 0.0)), hash(i + vec2(1.0, 0.0)), f.x),
                       mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
        }

        void main() {
            // 1. DYNAMIC CENTERING
            float centerOffset = uSidebarWidth / (2.0 * uResolution.x);
            float centerX = 0.5 + centerOffset;
            
            // Warp coordinates to ensure symmetry of HEIGHT at screen edges (x=0 and x=1)
            // Left side (Sidebar side) is the reference height (don't change it).
            // Right side is stretched to match that height at the edge.
            float distRaw = vUv.x - centerX;
            float symX = 0.0;
            
            if (distRaw < 0.0) {
                // Left Side: Use actual distance
                symX = abs(distRaw);
            } else {
                // Right Side: Normalize so that edge (x=1) matches Left edge (x=0) effective distance
                // Left max dist = centerX. Right max dist = (1.0 - centerX).
                // Scale right side by (centerX / (1.0 - centerX))
                symX = distRaw * (centerX / (1.0 - centerX));
            }

            vec2 symUv = vec2(symX, vUv.y);

            // 2. MORPHING PARAMETERS
            // Slope: MUCH flatter (wide horizon). 0.0 -> 0.3
            float currentSlope = mix(0.0, 0.3, uProgress); 
            float noiseStrength = mix(0.45, 0.15, uProgress);
            float noiseScaleY = mix(3.0, 1.5, uProgress);

            // 3. SHAPE CALCULATION
            // Wide U-shape, barely curving down at edges
            float geometricShape = pow(symX, 1.5) * currentSlope; 
            
            float blobNoise = noise(vec2(symUv.x * 2.5, symUv.y * noiseScaleY - uTime));
            
            // Rise Offset - VISIBLE IMMEDIATELY
            // Start from -0.3 (already partially visible), Rise to 0.8
            float riseOffset = mix(-0.3, 0.8, uProgress);
            
            float topSurfaceHeight = geometricShape + (blobNoise * noiseStrength) + riseOffset;

            // 4. COLOR DISTRIBUTION
            float liquidDepth = topSurfaceHeight - vUv.y;
            
            // Soft opacity edge
            float edgeBlur = mix(0.8, 0.5, uProgress); 
            float alpha = smoothstep(0.0, edgeBlur, liquidDepth);

            // 5. INTERNAL WOBBLE
            // Reduced constant wobble for stability, or could be retained if only "vertical" movement was unwanted.
            // User said "don't make the gradient move", implying totally static.
            // We lock uTime in the JS loop, but here we keep the math generic.
            float internalWobble = noise(vec2(symUv.x * 4.0, symUv.y * 3.0 + uTime * 0.5));
            float distortedDepth = liquidDepth + (internalWobble * 0.15);

            // 6. COLOR LAYERS
            
            vec3 color = uColorTop; // Background Dark Gray
            
            // Blue transition (Squeezed - Upper Mid)
            float midMix = smoothstep(0.15, 0.6, distortedDepth);
            color = mix(color, uColorMid, midMix);
            
            // Pink transition (Expanded - Dominant)
            float botMix = smoothstep(0.35, 0.9, distortedDepth);
            color = mix(color, uColorBot, botMix);
            
            // Orange transition (Lower & More Orangish)
            // Starts deeper (0.9) to be smaller height
            vec3 colorOrange = vec3(1.0, 0.55, 0.1); // More Orangish (less pink)
            float orangeMix = smoothstep(0.9, 1.5, distortedDepth);
            color = mix(color, colorOrange, orangeMix);
            
            // Extra Glow
            color *= 1.15;

            gl_FragColor = vec4(color, alpha);
        }
    `

    const uniforms = {
        uTime: { value: 0 }, 
        uProgress: { value: 0 },
        uResolution: { value: new THREE.Vector2(container.clientWidth, container.clientHeight) },
        uSidebarWidth: { value: initialSidebarWidth },
        
        uColorTop: { value: new THREE.Color(0.05, 0.05, 0.05) }, // Darker Top
        uColorMid: { value: new THREE.Color(0.2, 0.5, 1.0) },    // Vibrant Blue (Electric)
        uColorBot: { value: new THREE.Color(1.0, 0.2, 0.6) }     // Vivid Hot Pink
    }

    const geometry = new THREE.PlaneBufferGeometry(2, 2)
    const material = new THREE.ShaderMaterial({
        vertexShader,
        fragmentShader,
        uniforms,
        transparent: true,
        depthWrite: false,
    })

    const mesh = new THREE.Mesh(geometry, material)
    scene.add(mesh)

    const clock = new THREE.Clock()
    const DURATION = 2.0 // Faster animation (was 3.5)

    function easeOutQuart(x: number): number {
        return 1 - Math.pow(1 - x, 4)
    }

    const animate = () => {
        sceneRef.current.animationId = requestAnimationFrame(animate)
        
        let rawTime = clock.getElapsedTime()
        let linearProgress = Math.min(Math.max(rawTime / DURATION, 0.0), 1.0)
        let easedProgress = easeOutQuart(linearProgress)

        uniforms.uProgress.value = easedProgress
        
        // FREEZE TIME AFTER ANIMATION
        // "Don't make the gradient move after it initially moves up"
        if (linearProgress < 1.0) {
            uniforms.uTime.value = easedProgress * 1.5
        } else {
            uniforms.uTime.value = 1.5 // Static fixed time
        }

        renderer.render(scene, camera)
    }

    const updateResolution = () => {
        if (!containerRef.current) return
        const width = containerRef.current.clientWidth
        const height = containerRef.current.clientHeight
        renderer.setSize(width, height)
        uniforms.uResolution.value.set(width, height)
    }
    window.addEventListener("resize", updateResolution)

    sceneRef.current = {
        renderer,
        uniforms,
        animationId: null,
        initialized: true,
        clock
    }

    animate()
  }

  return (
    <div
      ref={containerRef}
      className="w-full h-full absolute inset-0"
      style={{ 
        backgroundColor: '#1a1a1a', // Gray background for top area
        transition: 'background-color 0.5s ease'
      }}
    />
  )
}
