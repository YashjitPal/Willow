import React from 'react';

interface CustomizeIconProps {
  name: string;
  size?: number;
  className?: string;
}

export const CustomizeIcon: React.FC<CustomizeIconProps> = ({
  name,
  size = 20,
  className,
}) => {
  switch (name) {
    case 'draw':
      // Google Symbols draw
      return (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          height={size}
          width={size}
          viewBox="0 -960 960 960"
          fill="currentColor"
          className={className}
          aria-hidden="true"
        >
          <path d="M160-120v-170l527-526q12-12 27-18t30-6q16 0 30.5 6t25.5 18l56 56q12 11 18 25.5t6 30.5q0 15-6 30t-18 27L330-120H160Zm80-80h56l393-392-28-29-29-28-392 393v56Zm560-503-57-57 57 57Zm-139 82-29-28 57 57-28-29ZM560-120q74 0 137-37t63-103q0-36-19-62t-51-45l-59 59q23 10 36 22t13 26q0 23-36.5 41.5T560-200q-17 0-28.5 11.5T520-160q0 17 11.5 28.5T560-120ZM183-426l60-60q-20-8-31.5-16.5T200-520q0-12 18-24t76-37q88-38 117-69t29-70q0-55-44-87.5T280-840q-45 0-80.5 16T145-785q-11 13-9 29t15 26q13 11 29 9t27-13q14-14 31-20t42-6q41 0 60.5 12t19.5 28q0 14-17.5 25.5T262-654q-80 35-111 63.5T120-520q0 32 17 54.5t46 39.5Z" />
        </svg>
      );

    case 'target':
      // Google Symbols target
      return (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          height={size}
          width={size}
          viewBox="0 -960 960 960"
          fill="currentColor"
          className={className}
          aria-hidden="true"
        >
          <path d="M324-111.5Q251-143 197-197t-85.5-127Q80-397 80-480t31.5-156Q143-709 197-763t127-85.5Q397-880 480-880t156 31.5Q709-817 763-763t85.5 127Q880-563 880-480t-31.5 156Q817-251 763-197t-127 85.5Q563-80 480-80t-156-31.5ZM707-253q93-93 93-227t-93-227q-93-93-227-93t-227 93q-93 93-93 227t93 227q93 93 227 93t227-93Zm-397-57q-70-70-70-170t70-170q70-70 170-70t170 70q70 70 70 170t-70 170q-70 70-170 70t-170-70Zm283-57q47-47 47-113t-47-113q-47-47-113-47t-113 47q-47 47-47 113t47 113q47 47 113 47t113-47Zm-169.5-56.5Q400-447 400-480t23.5-56.5Q447-560 480-560t56.5 23.5Q560-513 560-480t-23.5 56.5Q513-400 480-400t-56.5-23.5Z" />
        </svg>
      );

    case 'lightbulb':
      // Google Symbols lightbulb
      return (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          height={size}
          width={size}
          viewBox="0 -960 960 960"
          fill="currentColor"
          className={className}
          aria-hidden="true"
        >
          <path d="M423.5-103.5Q400-127 400-160h160q0 33-23.5 56.5T480-80q-33 0-56.5-23.5ZM320-200v-80h320v80H320Zm10-120q-69-41-109.5-110T180-580q0-125 87.5-212.5T480-880q125 0 212.5 87.5T780-580q0 81-40.5 150T630-320H330Zm24-80h252q45-32 69.5-79T700-580q0-92-64-156t-156-64q-92 0-156 64t-64 156q0 54 24.5 101t69.5 79Zm126 0Z" />
        </svg>
      );

    case 'potted_plant':
      // Google Symbols potted_plant
      return (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          height={size}
          width={size}
          viewBox="0 -960 960 960"
          fill="currentColor"
          className={className}
          aria-hidden="true"
        >
          <path d="M342-160h276l40-160H302l40 160Zm0 80q-28 0-49-17t-28-44l-45-179h520l-45 179q-7 27-28 44t-49 17H342ZM200-400h560v-80H200v80Zm280-240q0-100 70-170t170-70q0 90-57 156t-143 80v84h320v160q0 33-23.5 56.5T760-320H200q-33 0-56.5-23.5T120-400v-160h320v-84q-86-14-143-80t-57-156q100 0 170 70t70 170Z" />
        </svg>
      );

    case 'whiteboard':
      // Google Symbols whiteboard
      return (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          height={size}
          width={size}
          viewBox="0 -960 960 960"
          fill="currentColor"
          className={className}
          aria-hidden="true"
        >
          <path d="M200-240v-200l398-398q42-42 100-42t100 42q42 42 42 100t-42 100L400-240H200Zm80-80h87l375-375q18-18 18-43.5T742-782q-18-18-43.5-18T655-782L280-407v87ZM120-80v-80h720v80H120Z" />
        </svg>
      );

    case 'apple_music':
    case 'playlist_add':
    case 'music_note':
      // Apple Music signature double-note glyph
      return (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          height={size}
          width={size}
          viewBox="0 0 24 24"
          fill="currentColor"
          className={className}
          aria-hidden="true"
        >
          <path d="M18.8 3.52c-.36-.34-.87-.49-1.36-.41l-7.75 1.29c-.7.12-1.22.71-1.22 1.42v9.79c-.58-.33-1.25-.51-1.97-.51-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V9.82l6.5-1.08v5.87c-.58-.33-1.25-.51-1.97-.51-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V4.71c0-.49-.24-.95-.63-1.19z" />
        </svg>
      );

    case 'edit_note':
      // Google Symbols edit_note
      return (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          height={size}
          width={size}
          viewBox="0 -960 960 960"
          fill="currentColor"
          className={className}
          aria-hidden="true"
        >
          <path d="M160-400v-80h280v80H160Zm0-160v-80h440v80H160Zm0-160v-80h440v80H160Zm360 560v-123l221-220q9-9 20-13t22-4q12 0 23 4.5t20 13.5l37 37q8 9 12.5 20t4.5 22q0 11-4 22.5T863-380L643-160H520Zm300-263-37-37 37 37ZM580-220h38l121-122-18-19-19-18-122 121v38Zm141-141-19-18 37 37-18-19Z" />
        </svg>
      );

    case 'contract':
      return (
        <span
          aria-hidden="true"
          className={`luminous-symbols inline-flex shrink-0 select-none items-center justify-center ${className || ''}`}
          style={{
            fontFamily: '"Luminous Symbols"',
            fontSize: size,
            lineHeight: `${size}px`,
            width: size,
            height: size,
            fontWeight: 300,
            fontVariationSettings: `"FILL" 0, "GRAD" 0, "ROND" 100, "opsz" ${size}, "wght" 300`,
          }}
        >
          contract
        </span>
      );

    case 'chat_spark':
      return (
        <span
          aria-hidden="true"
          className={`luminous-symbols inline-flex shrink-0 select-none items-center justify-center ${className || ''}`}
          style={{
            fontFamily: '"Luminous Symbols"',
            fontSize: size,
            lineHeight: `${size}px`,
            width: size,
            height: size,
            fontWeight: 300,
            fontVariationSettings: `"FILL" 0, "GRAD" 0, "ROND" 100, "opsz" ${size}, "wght" 300`,
          }}
        >
          chat_spark
        </span>
      );

    case 'download':
      return (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          height={size}
          width={size}
          viewBox="0 -960 960 960"
          fill="currentColor"
          className={className}
          aria-hidden="true"
        >
          <path d="M480-320 280-520l56-58 104 104v-326h80v326l104-104 56 58-280 280ZM240-160q-33 0-56.5-23.5T160-240v-120h80v120h480v-120h80v120q0 33-23.5 56.5T720-160H240Z" />
        </svg>
      );

    case 'check_circle':
      return (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          height={size}
          width={size}
          viewBox="0 -960 960 960"
          fill="currentColor"
          className={className}
          aria-hidden="true"
        >
          <path d="M480-80q-83 0-156-31.5T197-197q-54-54-85.5-127T80-480q0-83 31.5-156T197-763q54-54 127-85.5T480-880q83 0 156 31.5T763-763q54 54 85.5 127T880-480q0 83-31.5 156T763-197q-54 54-127 85.5T480-80Zm-40-280 240-240-56-56-184 184-72-72-56 56 128 128Z" />
        </svg>
      );

    case 'add':
      return (
        <span
          aria-hidden="true"
          className={`luminous-symbols inline-flex shrink-0 select-none items-center justify-center ${className || ''}`}
          style={{
            fontFamily: '"Luminous Symbols"',
            fontSize: size,
            lineHeight: `${size}px`,
            width: size,
            height: size,
            fontWeight: 300,
            fontVariationSettings: `"FILL" 0, "GRAD" 0, "ROND" 100, "opsz" ${size}, "wght" 300`,
          }}
        >
          add
        </span>
      );

    case 'more_vert':
      return (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          height={size}
          width={size}
          viewBox="0 0 24 24"
          fill="currentColor"
          className={className}
          aria-hidden="true"
        >
          <circle cx="12" cy="5" r="1.75" />
          <circle cx="12" cy="12" r="1.75" />
          <circle cx="12" cy="19" r="1.75" />
        </svg>
      );

    case 'more_horiz':
      return (
        <span
          aria-hidden="true"
          className={`luminous-symbols inline-flex shrink-0 select-none items-center justify-center ${className || ''}`}
          style={{
            fontFamily: '"Luminous Symbols"',
            fontSize: size,
            lineHeight: `${size}px`,
            width: size,
            height: size,
            fontWeight: 300,
            fontVariationSettings: `"FILL" 0, "GRAD" 0, "ROND" 100, "opsz" ${size}, "wght" 300`,
          }}
        >
          more_horiz
        </span>
      );

    case 'arrow_back':
      return (
        <span
          aria-hidden="true"
          className={`luminous-symbols inline-flex shrink-0 select-none items-center justify-center ${className || ''}`}
          style={{
            fontFamily: '"Luminous Symbols"',
            fontSize: size,
            lineHeight: `${size}px`,
            width: size,
            height: size,
            fontWeight: 330,
            fontVariationSettings: `"FILL" 0, "GRAD" 0, "ROND" 100, "opsz" ${size}, "wght" 330`,
          }}
        >
          arrow_back
        </span>
      );

    case 'keyboard_arrow_right':
      return (
        <span
          aria-hidden="true"
          className={`luminous-symbols inline-flex shrink-0 select-none items-center justify-center ${className || ''}`}
          style={{
            fontFamily: '"Luminous Symbols"',
            fontSize: size,
            lineHeight: 1,
            width: size,
            height: size,
            fontWeight: 260,
            fontVariationSettings: `"FILL" 0, "GRAD" 0, "ROND" 100, "opsz" ${size}, "wght" 260`,
          }}
        >
          keyboard_arrow_right
        </span>
      );

    case 'search':
      return (
        <span
          aria-hidden="true"
          className={`luminous-symbols inline-flex shrink-0 select-none items-center justify-center ${className || ''}`}
          style={{
            fontFamily: '"Luminous Symbols"',
            fontSize: size,
            lineHeight: 1,
            width: size,
            height: size,
            fontWeight: 320,
            fontVariationSettings: `"FILL" 0, "GRAD" 0, "ROND" 100, "opsz" ${size}, "wght" 320`,
          }}
        >
          search
        </span>
      );

    case 'close':
      return (
        <span
          aria-hidden="true"
          className={`luminous-symbols inline-flex shrink-0 select-none items-center justify-center ${className || ''}`}
          style={{
            fontFamily: '"Luminous Symbols"',
            fontSize: size,
            lineHeight: 1,
            width: size,
            height: size,
            fontWeight: 320,
            fontVariationSettings: `"FILL" 0, "GRAD" 0, "ROND" 100, "opsz" ${size}, "wght" 320`,
          }}
        >
          close
        </span>
      );

    case 'arrow_drop_down':
      return (
        <span
          aria-hidden="true"
          className={`google-symbols inline-flex shrink-0 select-none items-center justify-center ${className || ''}`}
          style={{
            fontFamily: '"Google Symbols"',
            fontSize: size,
            lineHeight: `${size}px`,
            width: size,
            height: size,
            fontWeight: 300,
            fontVariationSettings: `"FILL" 0, "GRAD" 0, "ROND" 100, "opsz" ${size}, "wght" 300`,
          }}
        >
          arrow_drop_down
        </span>
      );

    case 'chat_bubble':
      return (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          height={size}
          width={size}
          viewBox="0 -960 960 960"
          fill="currentColor"
          className={className}
          aria-hidden="true"
        >
          <path d="M80-80v-720q0-33 23.5-56.5T160-880h640q33 0 56.5 23.5T880-800v480q0 33-23.5 56.5T800-240H240L80-80Zm126-240h594v-480H160v525l46-45Zm-46 0v-480 480Z" />
        </svg>
      );

    case 'edit_note':
      return (
        <span
          aria-hidden="true"
          className={`google-symbols inline-flex shrink-0 select-none items-center justify-center ${className || ''}`}
          style={{
            fontFamily: '"Google Symbols"',
            fontSize: size,
            lineHeight: `${size}px`,
            width: size,
            height: size,
            fontWeight: 400,
            fontVariationSettings: `"FILL" 0, "wght" 400, "GRAD" 0, "opsz" ${size}`,
          }}
        >
          edit_note
        </span>
      );

    case 'edit':
      return (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          height={size}
          width={size}
          viewBox="0 -960 960 960"
          fill="currentColor"
          className={className}
          aria-hidden="true"
        >
          <path d="M200-200h57l391-391-57-57-391 391v57Zm-80 80v-170l528-527q12-11 26.5-17t30.5-6q16 0 31 6t26 18l55 56q12 11 17.5 26t5.5 30q0 16-5.5 30.5T817-647L290-120H120Zm640-584-56-56 56 56Zm-141 85-28-29 57 57-29-28Z" />
        </svg>
      );

    case 'upload':
      return (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          height={size}
          width={size}
          viewBox="0 -960 960 960"
          fill="currentColor"
          className={className}
          aria-hidden="true"
        >
          <path d="M440-320v-326L336-542l-56-58 200-200 200 200-56 58-104-104v326h-80ZM240-160q-33 0-56.5-23.5T160-240v-120h80v120h480v-120h80v120q0 33-23.5 56.5T720-160H240Z" />
        </svg>
      );

    case 'block':
      return (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          height={size}
          width={size}
          viewBox="0 -960 960 960"
          fill="currentColor"
          className={className}
          aria-hidden="true"
        >
          <path d="M324-111.5Q251-143 197-197t-85.5-127Q80-397 80-480t31.5-156Q143-709 197-763t127-85.5Q397-880 480-880t156 31.5Q709-817 763-763t85.5 127Q880-563 880-480t-31.5 156Q817-251 763-197t-127 85.5Q563-80 480-80t-156-31.5ZM480-160q54 0 104-17.5t92-50.5L228-676q-33 42-50.5 92T160-480q0 134 93 227t227 93Zm252-124q33-42 50.5-92T800-480q0-134-93-227t-227-93q-54 0-104 17.5T284-732l448 448ZM480-480Z" />
        </svg>
      );

    case 'delete':
      return (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          height={size}
          width={size}
          viewBox="0 -960 960 960"
          fill="currentColor"
          className={className}
          aria-hidden="true"
        >
          <path d="M280-120q-33 0-56.5-23.5T200-200v-520h-40v-80h200v-40h240v40h200v80h-40v520q0 33-23.5 56.5T680-120H280Zm400-600H280v520h400v-520ZM360-280h80v-360h-80v360Zm160 0h80v-360h-80v360ZM280-720v520-520Z" />
        </svg>
      );

    case 'prompt_suggestion':
      return (
        <span
          className={`luminous-symbols ${className || ''}`}
          style={{
            fontSize: size,
            width: size,
            height: size,
            lineHeight: 1,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
          aria-hidden="true"
        >
          prompt_suggestion
        </span>
      );

    case 'check':
      return (
        <span
          className={`luminous-symbols ${className || ''}`}
          style={{
            fontSize: size,
            width: size,
            height: size,
            lineHeight: 1,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
          aria-hidden="true"
        >
          check
        </span>
      );

    default:
      return (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          height={size}
          width={size}
          viewBox="0 -960 960 960"
          fill="currentColor"
          className={className}
          aria-hidden="true"
        >
          <path d="M160-400v-80h280v80H160Zm0-160v-80h440v80H160Zm0-160v-80h440v80H160Zm360 560v-123l221-220q9-9 20-13t22-4q12 0 23 4.5t20 13.5l37 37q8 9 12.5 20t4.5 22q0 11-4 22.5T863-380L643-160H520Zm300-263-37-37 37 37ZM580-220h38l121-122-18-19-19-18-122 121v38Zm141-141-19-18 37 37-18-19Z" />
        </svg>
      );
  }
};
