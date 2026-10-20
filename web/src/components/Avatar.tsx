import { useEffect, useState } from "react";

/** A round profile picture, or the person's initial when there isn't one. */
export default function Avatar({
  name,
  imageUrl,
  size = 40,
}: {
  name: string;
  imageUrl: string | null;
  size?: number;
}) {
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [imageUrl]);
  const style = { width: size, height: size, fontSize: Math.round(size * 0.42) };
  if (imageUrl && !broken) {
    return (
      <img
        className="avatar"
        src={imageUrl}
        alt=""
        width={size}
        height={size}
        style={style}
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={() => setBroken(true)}
      />
    );
  }
  return (
    <span className="avatar avatar-initial" style={style} aria-hidden="true">
      {(name.trim()[0] ?? "?").toUpperCase()}
    </span>
  );
}
