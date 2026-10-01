"use client";

// ============================================================================
// Dropping files from the operating system onto a region of the page.
// ----------------------------------------------------------------------------
// One implementation for every upload drop zone, so they look and behave alike:
// dashed border at rest, solid border and a faint tint while a file is over it,
// reverting at once on drop or leave.
//
// A drag that carries OS files has "Files" in dataTransfer.types. An in-page drag
// (reordering gallery photos) does not. Every handler here ignores anything
// without "Files", so a thumbnail being reordered is never read as an upload and
// an upload never lights up the reorder targets. For the same reason a drop
// without files is not preventDefault()ed, so the in-page handlers still get it.
//
// The zone only ever hands the files to the caller. It never uploads anything.
// ============================================================================
import { useRef, useState, type DragEvent } from "react";

/** True when a drag carries files from outside the page. Works on DOMStringList too. */
export function hasFiles(types: ArrayLike<string> | null | undefined): boolean {
  return !!types && Array.from(types).includes("Files");
}

/** Classes for a drop zone: dashed at rest, solid and tinted while a file is over it. */
export function dropZoneClass(over: boolean): string {
  return over
    ? "border border-solid border-purple bg-purple/5 transition-colors"
    : "border border-dashed border-line transition-colors";
}

export interface FileDrop {
  /** True while an OS file is over the zone. */
  over: boolean;
  /** Spread onto the zone element. */
  bind: {
    onDragEnter: (e: DragEvent) => void;
    onDragOver: (e: DragEvent) => void;
    onDragLeave: (e: DragEvent) => void;
    onDrop: (e: DragEvent) => void;
  };
}

export function useFileDrop(
  onFiles: (files: File[]) => void,
  options: { disabled?: boolean } = {},
): FileDrop {
  const [over, setOver] = useState(false);
  // dragenter/dragleave fire for every child the pointer crosses; count them so
  // the highlight does not flicker off while still inside the zone.
  const depth = useRef(0);
  const off = options.disabled === true;

  return {
    over: over && !off,
    bind: {
      onDragEnter: (e) => {
        if (off || !hasFiles(e.dataTransfer?.types)) return;
        depth.current += 1;
        setOver(true);
      },
      onDragOver: (e) => {
        if (off || !hasFiles(e.dataTransfer?.types)) return;
        e.preventDefault(); // required, or the browser refuses the drop
        e.dataTransfer.dropEffect = "copy";
      },
      onDragLeave: (e) => {
        if (off || !hasFiles(e.dataTransfer?.types)) return;
        depth.current = Math.max(0, depth.current - 1);
        if (depth.current === 0) setOver(false);
      },
      onDrop: (e) => {
        if (off || !hasFiles(e.dataTransfer?.types)) return;
        e.preventDefault();
        depth.current = 0;
        setOver(false);
        onFiles(Array.from(e.dataTransfer.files));
      },
    },
  };
}
