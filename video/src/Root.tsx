import "./index.css";
import { Composition, Folder } from "remotion";
import { PapervineVideo } from "./PapervineVideo";
import { ColdOpen } from "./scenes/ColdOpen";
import { Brand } from "./scenes/Brand";
import { Connect } from "./scenes/Connect";
import { Site } from "./scenes/Site";
import { Search } from "./scenes/Search";
import { Playground } from "./scenes/Playground";
import { Editor } from "./scenes/Editor";
import { Assistant } from "./scenes/Assistant";
import { AgentReady } from "./scenes/AgentReady";
import { ReaderAuth } from "./scenes/ReaderAuth";
import { Analytics } from "./scenes/Analytics";
import { Close } from "./scenes/Close";

/**
 * `PapervineTour` is the deliverable. Every scene is also registered on its own under Scenes so
 * it can be previewed and retimed in isolation — and so double-clicking a sequence in the tour
 * timeline jumps straight to that scene's own composition.
 */
export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="PapervineTour"
        component={PapervineVideo}
        durationInFrames={3168}
        fps={30}
        width={1920}
        height={1080}
      />

      <Folder name="Scenes">
        <Composition
          id="ColdOpen"
          component={ColdOpen}
          durationInFrames={150}
          fps={30}
          width={1920}
          height={1080}
        />
        <Composition
          id="Brand"
          component={Brand}
          durationInFrames={120}
          fps={30}
          width={1920}
          height={1080}
        />
        <Composition
          id="Connect"
          component={Connect}
          durationInFrames={360}
          fps={30}
          width={1920}
          height={1080}
        />
        <Composition
          id="Site"
          component={Site}
          durationInFrames={330}
          fps={30}
          width={1920}
          height={1080}
        />
        <Composition
          id="Search"
          component={Search}
          durationInFrames={240}
          fps={30}
          width={1920}
          height={1080}
        />
        <Composition
          id="Playground"
          component={Playground}
          durationInFrames={270}
          fps={30}
          width={1920}
          height={1080}
        />
        <Composition
          id="Editor"
          component={Editor}
          durationInFrames={420}
          fps={30}
          width={1920}
          height={1080}
        />
        <Composition
          id="Assistant"
          component={Assistant}
          durationInFrames={360}
          fps={30}
          width={1920}
          height={1080}
        />
        <Composition
          id="AgentReady"
          component={AgentReady}
          durationInFrames={300}
          fps={30}
          width={1920}
          height={1080}
        />
        <Composition
          id="ReaderAuth"
          component={ReaderAuth}
          durationInFrames={270}
          fps={30}
          width={1920}
          height={1080}
        />
        <Composition
          id="Analytics"
          component={Analytics}
          durationInFrames={240}
          fps={30}
          width={1920}
          height={1080}
        />
        <Composition
          id="Close"
          component={Close}
          durationInFrames={240}
          fps={30}
          width={1920}
          height={1080}
        />
      </Folder>
    </>
  );
};
