import React, { useRef, useEffect, useState, memo } from 'react';
// @ts-ignore
import stitchAuroraVideo from '@willow/assets/animations/stitch-aurora.mp4';

const REMOTE_FALLBACK_URL =
  'https://storage.googleapis.com/gweb-gemini-cdn/gemini/uploads/89e9004d716a7803fc7c9aab18c985af783f5a36.mp4';

interface StitchAuroraProps {
  className?: string;
}

const StitchAuroraComponent: React.FC<StitchAuroraProps> = ({ className }) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    video.play().catch(() => {
      // Autoplay with audio muted is permitted across browsers
    });
  }, []);

  return (
    <div
      className={className}
      style={{
        opacity: isLoaded ? 1 : 0,
        transition: 'opacity 1s ease-in-out',
        mixBlendMode: 'screen',
      }}
    >
      <video
        ref={videoRef}
        autoPlay
        muted
        loop
        playsInline
        onPlaying={() => setIsLoaded(true)}
        className="h-full w-full object-cover"
        style={{ mixBlendMode: 'screen' }}
      >
        <source src={stitchAuroraVideo || REMOTE_FALLBACK_URL} type="video/mp4" />
        <source src={REMOTE_FALLBACK_URL} type="video/mp4" />
      </video>
    </div>
  );
};

export const StitchAurora = memo(StitchAuroraComponent);
export default StitchAurora;
