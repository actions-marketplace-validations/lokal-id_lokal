import { fade } from "@remotion/transitions/fade";
import { linearTiming, TransitionSeries } from "@remotion/transitions";
import type React from "react";
import { useVideoConfig } from "remotion";
import type { Lang } from "../copy";
import { BrowserScene } from "./BrowserScene";
import { HookScene, OutroScene } from "./TitleScenes";

export type ExtensionDemoProps = { readonly lang: Lang };

// 75 + 600 + 120 frames, minus two 12-frame fades: 771 frames, about 26 seconds at 30 fps.
export const ExtensionDemo: React.FC<ExtensionDemoProps> = ({ lang }) => {
  const { fps } = useVideoConfig();
  return (
    <TransitionSeries>
      <TransitionSeries.Sequence name="Hook" durationInFrames={75} premountFor={fps}>
        <HookScene lang={lang} />
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition presentation={fade()} timing={linearTiming({ durationInFrames: 12 })} />
      <TransitionSeries.Sequence name="Browser" durationInFrames={600} premountFor={fps}>
        <BrowserScene lang={lang} />
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition presentation={fade()} timing={linearTiming({ durationInFrames: 12 })} />
      <TransitionSeries.Sequence name="Outro" durationInFrames={120} premountFor={fps}>
        <OutroScene lang={lang} />
      </TransitionSeries.Sequence>
    </TransitionSeries>
  );
};
