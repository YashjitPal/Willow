import type { SVGProps } from 'react';

/** The bots mark: a bot inside a ring, as on Codex's "Your bot" sidebar row. */
export function DotsLogo(props: SVGProps<SVGSVGElement>) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={20} height={20} fill="none" viewBox="0 0 20 20" aria-hidden="true" {...props}>
      <path stroke="currentColor" strokeWidth={1.33} d="M10.01 7.07a2.938 2.938 0 1 1 0 5.876 2.938 2.938 0 0 1 0-5.877Z" />
      <path stroke="currentColor" strokeWidth={1.33} d="M10.008 2.665a7.343 7.343 0 1 1 0 14.686 7.343 7.343 0 0 1 0-14.686Z" />
    </svg>
  );
}
