import type { SVGProps } from "react";

export function MicrosoftLogoIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg width={24} height={24} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" {...props}>
      <path d="M3.25 3.25H11.25V11.25H3.25V3.25Z" fill="#F35325" />
      <path d="M12.75 3.25H20.75V11.25H12.75V3.25Z" fill="#81BC06" />
      <path d="M3.25 12.75H11.25V20.75H3.25V12.75Z" fill="#05A6F0" />
      <path d="M12.75 12.75H20.75V20.75H12.75V12.75Z" fill="#FFBA08" />
    </svg>
  );
}
