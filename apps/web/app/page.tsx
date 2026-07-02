import { Badge } from "@astryxdesign/core/Badge";
import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { Divider } from "@astryxdesign/core/Divider";
import { Grid } from "@astryxdesign/core/Grid";
import { HStack, StackItem, VStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";

const features = [
  {
    title: "Schematic editor",
    body: "Place parts, draw nets, and annotate — a direct-manipulation canvas that feels like a design tool, not a CAD relic.",
  },
  {
    title: "Real SPICE, in the browser",
    body: "ngspice compiled to WebAssembly runs transient and operating-point analyses locally. No queue, no server, no upload.",
  },
  {
    title: "Firmware to a virtual MCU",
    body: "Build with PlatformIO and flash to an emulated ESP32 — watch your firmware run against the circuit you drew.",
  },
  {
    title: "One interchange format",
    body: "KiCad, ngspice, and PlatformIO speak through a single versioned IR. Your design is a portable JSON document, not a lock-in.",
  },
  {
    title: "Agent-native by design",
    body: "Every engine is wrapped in an MCP server. AI agents design, simulate, and review through the same contracts you use.",
  },
  {
    title: "Apache-2.0, patent grant included",
    body: "The whole platform — editor, engines, format — is open source. Fork it, embed it, ship products on it.",
  },
];

const pipeline = [
  { step: "01", name: "Design", detail: "Schematic → IR" },
  { step: "02", name: "Simulate", detail: "IR → ngspice waveforms" },
  { step: "03", name: "Flash", detail: "Firmware → virtual ESP32" },
];

export default function LandingPage() {
  return (
    <main style={{ maxWidth: 1080, margin: "0 auto", padding: "0 24px" }}>
      <div style={{ padding: "20px 0" }}>
        <HStack gap={2} vAlign="center">
          <Text type="label" size="lg" weight="bold">
            ⌬ OpenBench
          </Text>
          <Badge label="alpha" variant="info" />
          <StackItem size="fill">
            <span />
          </StackItem>
          <HStack gap={1}>
            <Button label="Projects" href="/projects" variant="ghost" />
            <Button
              label="GitHub"
              href="https://github.com/shuvamk/openbench"
              target="_blank"
              rel="noopener noreferrer"
              variant="ghost"
            />
            <Button label="Open the bench" href="/projects" variant="primary" />
          </HStack>
        </HStack>
      </div>

      <div style={{ padding: "88px 0 56px", textAlign: "center" }}>
        <VStack gap={3} hAlign="center">
          <Text type="display-1" as="div">
            The open workbench for electronics.
          </Text>
          <div style={{ maxWidth: 640 }}>
            <Text type="large" color="secondary" as="p">
              Design schematics, simulate circuits, and run firmware on virtual hardware — in one
              browser tab, on one open format, with zero proprietary lock-in.
            </Text>
          </div>
          <HStack gap={2} hAlign="center">
            <Button label="Start a project" href="/projects" variant="primary" size="lg" />
            <Button label="Try the editor" href="/editor/demo" variant="secondary" size="lg" />
          </HStack>
          <Text type="supporting" color="secondary">
            No account. No install. Runs entirely in your browser.
          </Text>
        </VStack>
      </div>

      <div style={{ padding: "8px 0 48px" }}>
        <Grid columns={{ minWidth: 220 }} gap={2}>
          {pipeline.map((p) => (
            <Card key={p.step} padding={3}>
              <VStack gap={1}>
                <Text type="code" color="secondary">
                  {p.step}
                </Text>
                <Text type="label" size="lg" weight="semibold">
                  {p.name}
                </Text>
                <Text type="supporting" color="secondary">
                  {p.detail}
                </Text>
              </VStack>
            </Card>
          ))}
        </Grid>
      </div>

      <Divider />

      <div style={{ padding: "56px 0" }}>
        <VStack gap={3}>
          <Text type="display-3" as="h2">
            Everything on the bench is open.
          </Text>
          <Grid columns={{ minWidth: 300 }} gap={2}>
            {features.map((f) => (
              <Card key={f.title} padding={4}>
                <VStack gap={1}>
                  <Text type="label" size="lg" weight="semibold">
                    {f.title}
                  </Text>
                  <Text type="body" color="secondary">
                    {f.body}
                  </Text>
                </VStack>
              </Card>
            ))}
          </Grid>
        </VStack>
      </div>

      <Divider />

      <div style={{ padding: "28px 0 44px" }}>
        <HStack gap={2} vAlign="center" wrap="wrap">
          <Text type="supporting" color="secondary">
            Built in the open, by agents and people, on KiCad · ngspice · Renode · PlatformIO.
          </Text>
          <StackItem size="fill">
            <span />
          </StackItem>
          <Button
            label="Apache-2.0"
            href="https://github.com/shuvamk/openbench/blob/main/LICENSE"
            target="_blank"
            rel="noopener noreferrer"
            variant="ghost"
            size="sm"
          />
          <Button
            label="Interchange format"
            href="https://github.com/shuvamk/openbench/blob/main/.context/interchange-format.md"
            target="_blank"
            rel="noopener noreferrer"
            variant="ghost"
            size="sm"
          />
        </HStack>
      </div>
    </main>
  );
}
