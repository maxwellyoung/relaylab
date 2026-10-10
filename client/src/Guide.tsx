import { useEffect, useId, useState, type ReactNode } from "react";
import { marked, type Token, type Tokens } from "marked";
import explanation from "../../docs/HOW_IT_WORKS.md?raw";
import gettingStarted from "../../docs/GETTING_STARTED.md?raw";

let renderer: Promise<(typeof import("mermaid"))["default"]> | undefined;
function diagramRenderer() {
  return (renderer ??= import("mermaid").then(({ default: mermaid }) => {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      theme: "base",
      themeVariables: {
        darkMode: true,
        background: "#18191d",
        primaryColor: "#282a37",
        primaryTextColor: "#e4e4eb",
        primaryBorderColor: "#55576b",
        lineColor: "#9293a6",
        secondaryColor: "#25272c",
        tertiaryColor: "#202226",
        fontFamily: "system-ui, sans-serif",
        fontSize: "14px",
        noteBkgColor: "#282a37",
        noteTextColor: "#e4e4eb",
        actorBkg: "#282a37",
        actorTextColor: "#e4e4eb",
      },
    });
    return mermaid;
  }));
}
function Diagram({ source }: { source: string }) {
  const id = `diagram-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const [svg, setSvg] = useState("");
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    diagramRenderer()
      .then((m) => m.render(id, source))
      .then((result) => {
        if (active) setSvg(result.svg);
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, [id, source]);
  // Source is bundled project documentation. Mermaid applies strict sanitization.
  return (
    <figure className="guide-diagram" aria-label="System diagram">
      {svg ? (
        <div
          className="diagram-svg"
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      ) : failed ? (
        <pre>{source}</pre>
      ) : (
        <p role="status">Drawing diagram…</p>
      )}
      <details>
        <summary>Read diagram source</summary>
        <pre>{source}</pre>
      </details>
    </figure>
  );
}
function safeHref(href: string) {
  if (/^(https?:\/\/|#)/i.test(href)) return href;
  if (/^(javascript|data|vbscript):/i.test(href)) return "#";
  return `https://github.com/maxwellyoung/relaylab/blob/main/${href.replace(/^\.\//, "")}`;
}
function inline(tokens: Token[] | undefined): ReactNode {
  return tokens?.map((token, i) => {
    switch (token.type) {
      case "strong":
        return <strong key={i}>{inline(token.tokens)}</strong>;
      case "em":
        return <em key={i}>{inline(token.tokens)}</em>;
      case "codespan":
        return <code key={i}>{token.text}</code>;
      case "link":
        return (
          <a key={i} href={safeHref(token.href)}>
            {inline(token.tokens)}
          </a>
        );
      case "br":
        return <br key={i} />;
      case "text":
        return (
          <span key={i}>
            {token.tokens ? inline(token.tokens) : token.text}
          </span>
        );
      default:
        return <span key={i}>{token.raw}</span>;
    }
  });
}
function blocks(tokens: Token[]): ReactNode {
  return tokens.map((token, i) => {
    switch (token.type) {
      case "heading": {
        const Tag = `h${Math.min(token.depth, 6)}` as "h1" | "h2" | "h3";
        return (
          <Tag key={i} id={slug(token.text)}>
            {inline(token.tokens)}
          </Tag>
        );
      }
      case "paragraph":
        return <p key={i}>{inline(token.tokens)}</p>;
      case "code":
        return token.lang === "mermaid" ? (
          <Diagram key={i} source={token.text} />
        ) : (
          <pre key={i}>
            <code>{token.text}</code>
          </pre>
        );
      case "list": {
        const Tag = token.ordered ? "ol" : "ul";
        return (
          <Tag key={i}>
            {token.items.map((item: Tokens.ListItem, j: number) => (
              <li key={j}>{blocks(item.tokens)}</li>
            ))}
          </Tag>
        );
      }
      case "text":
        return <span key={i}>{inline(token.tokens) ?? token.text}</span>;
      case "blockquote":
        return <blockquote key={i}>{blocks(token.tokens ?? [])}</blockquote>;
      case "space":
        return null;
      default:
        return <p key={i}>{token.raw}</p>;
    }
  });
}
function slug(text: string) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-");
}
export default function Guide() {
  const [tab, setTab] = useState<"explanation" | "start">("explanation");
  const tokens = marked.lexer(
    tab === "explanation" ? explanation : gettingStarted,
  );
  const headings = tokens.filter(
    (t): t is Extract<Token, { type: "heading" }> =>
      t.type === "heading" && t.depth === 2,
  );
  return (
    <div className="guide-view">
      <nav className="guide-tabs" aria-label="Guide chapters">
        <button
          type="button"
          aria-pressed={tab === "explanation"}
          onClick={() => setTab("explanation")}
        >
          The system explained
        </button>
        <button
          type="button"
          aria-pressed={tab === "start"}
          onClick={() => setTab("start")}
        >
          First run
        </button>
        <span>Read the source. Try the workflow.</span>
      </nav>
      <div className="guide-layout" key={tab}>
        <article className="guide-prose">{blocks(tokens)}</article>
        <nav className="guide-contents" aria-label="On this page">
          <p>On this page</p>
          {headings.map((t) => (
            <a key={t.text} href={`#${slug(t.text)}`}>
              {t.text}
            </a>
          ))}
        </nav>
      </div>
    </div>
  );
}
