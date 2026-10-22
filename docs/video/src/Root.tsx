import { Composition, Folder } from "remotion";
import { AgentDemo } from "./AgentDemo/AgentDemo";
import { BrowserScene } from "./ExtensionDemo/BrowserScene";
import { ExtensionDemo } from "./ExtensionDemo/ExtensionDemo";

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition id="ExtensionDemoID" component={ExtensionDemo} durationInFrames={771} fps={30} width={1280} height={720} defaultProps={{ lang: "id" as const }} />
      <Composition id="ExtensionDemoEN" component={ExtensionDemo} durationInFrames={771} fps={30} width={1280} height={720} defaultProps={{ lang: "en" as const }} />
      <Composition id="AgentDemoEN" component={AgentDemo} durationInFrames={480} fps={30} width={1280} height={484} defaultProps={{ lang: "en" as const }} />
      <Composition id="AgentDemoID" component={AgentDemo} durationInFrames={480} fps={30} width={1280} height={484} defaultProps={{ lang: "id" as const }} />
      <Folder name="Scenes">
        <Composition id="Browser" component={BrowserScene} durationInFrames={600} fps={30} width={1280} height={720} defaultProps={{ lang: "id" as const }} />
      </Folder>
    </>
  );
};
