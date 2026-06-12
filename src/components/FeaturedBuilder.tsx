import { Sparkles } from 'lucide-react';

interface Props {
  /** Display name of the featured builder. */
  name: string;
  /** Small label shown above the name. Defaults to "Featured Builder". */
  label?: string;
  /** Path to the player render (transparent PNG). Defaults to the public asset. */
  avatarSrc?: string;
}

export function FeaturedBuilder({
  name,
  label = 'Featured Builder',
  avatarSrc = `${import.meta.env.BASE_URL}featured-builder.png`,
}: Props) {
  return (
    <a
      className="featured-builder"
      href="https://www.youtube.com/watch?v=KO1yKa34Yl0"
      target="_blank"
      rel="noreferrer"
      aria-label={`${label}: ${name}. Opens YouTube in a new tab.`}
      title={`Watch ${name} on YouTube`}
    >
      <span className="featured-builder-spark" aria-hidden="true">
        <Sparkles size={16} />
      </span>
      <div className="featured-builder-text">
        <strong className="featured-builder-name">{name}</strong>
        <span className="featured-builder-label">{label}</span>
      </div>
      <img
        className="featured-builder-avatar"
        src={avatarSrc}
        alt=""
        aria-hidden="true"
        draggable={false}
      />
    </a>
  );
}
