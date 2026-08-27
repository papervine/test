import { AbsoluteFill } from "remotion";
import { TransitionSeries, linearTiming } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import { slide } from "@remotion/transitions/slide";
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
 * The full product tour — see SCRIPT.md for the narration and the shot-by-shot reasoning.
 *
 * Every transition is 12 frames and overlaps the scenes it joins, so the total runs
 * 3300 − (11 × 12) = 3168 frames (1:45.6 at 30fps). Durations are written inline rather than
 * computed so they stay draggable in the Studio timeline.
 *
 * Transitions are fades except two deliberate slides: into the product for the first time, and
 * into the editor. Motion means something here rather than decorating every cut.
 *
 * To add a voiceover, drop the file at `public/voiceover.mp3` and uncomment the <Audio> below.
 */
export const PapervineVideo: React.FC = () => {
  return (
    <AbsoluteFill name="Papervine tour" style={{ backgroundColor: "#060609" }}>
      {/* <Audio src={staticFile("voiceover.mp3")} /> — import { Audio } from "@remotion/media" */}

      <TransitionSeries>
        <TransitionSeries.Sequence durationInFrames={150} name="1 · Cold open">
          <ColdOpen />
        </TransitionSeries.Sequence>
        <TransitionSeries.Transition
          presentation={fade()}
          timing={linearTiming({ durationInFrames: 12 })}
        />

        <TransitionSeries.Sequence durationInFrames={120} name="2 · Brand">
          <Brand />
        </TransitionSeries.Sequence>
        <TransitionSeries.Transition
          presentation={slide({ direction: "from-bottom" })}
          timing={linearTiming({ durationInFrames: 12 })}
        />

        <TransitionSeries.Sequence durationInFrames={360} name="3 · Connect">
          <Connect />
        </TransitionSeries.Sequence>
        <TransitionSeries.Transition
          presentation={fade()}
          timing={linearTiming({ durationInFrames: 12 })}
        />

        <TransitionSeries.Sequence durationInFrames={330} name="4 · Rendered site">
          <Site />
        </TransitionSeries.Sequence>
        <TransitionSeries.Transition
          presentation={fade()}
          timing={linearTiming({ durationInFrames: 12 })}
        />

        <TransitionSeries.Sequence durationInFrames={240} name="5 · Search">
          <Search />
        </TransitionSeries.Sequence>
        <TransitionSeries.Transition
          presentation={fade()}
          timing={linearTiming({ durationInFrames: 12 })}
        />

        <TransitionSeries.Sequence durationInFrames={270} name="6 · API playground">
          <Playground />
        </TransitionSeries.Sequence>
        <TransitionSeries.Transition
          presentation={slide({ direction: "from-right" })}
          timing={linearTiming({ durationInFrames: 12 })}
        />

        <TransitionSeries.Sequence durationInFrames={420} name="7 · Editor">
          <Editor />
        </TransitionSeries.Sequence>
        <TransitionSeries.Transition
          presentation={fade()}
          timing={linearTiming({ durationInFrames: 12 })}
        />

        <TransitionSeries.Sequence durationInFrames={360} name="8 · Assistant">
          <Assistant />
        </TransitionSeries.Sequence>
        <TransitionSeries.Transition
          presentation={fade()}
          timing={linearTiming({ durationInFrames: 12 })}
        />

        <TransitionSeries.Sequence durationInFrames={300} name="9 · Built for agents">
          <AgentReady />
        </TransitionSeries.Sequence>
        <TransitionSeries.Transition
          presentation={fade()}
          timing={linearTiming({ durationInFrames: 12 })}
        />

        <TransitionSeries.Sequence durationInFrames={270} name="10 · Reader auth">
          <ReaderAuth />
        </TransitionSeries.Sequence>
        <TransitionSeries.Transition
          presentation={fade()}
          timing={linearTiming({ durationInFrames: 12 })}
        />

        <TransitionSeries.Sequence durationInFrames={240} name="11 · Analytics">
          <Analytics />
        </TransitionSeries.Sequence>
        <TransitionSeries.Transition
          presentation={fade()}
          timing={linearTiming({ durationInFrames: 12 })}
        />

        <TransitionSeries.Sequence durationInFrames={240} name="12 · Close">
          <Close />
        </TransitionSeries.Sequence>
      </TransitionSeries>
    </AbsoluteFill>
  );
};
