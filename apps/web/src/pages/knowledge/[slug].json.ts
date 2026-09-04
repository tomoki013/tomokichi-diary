import { projectTravelKnowledge } from "@tomokichi/application";
import { content } from "../../lib/content";

export function getStaticPaths() {
  return content.publicArticles().flatMap((article) => {
    const knowledge = content.knowledgeOf(article.id);
    return knowledge ? [{ params: { slug: article.slug }, props: { knowledge } }] : [];
  });
}

export function GET({
  props,
}: {
  props: { knowledge: NonNullable<ReturnType<typeof content.knowledgeOf>> };
}) {
  return new Response(`${JSON.stringify(projectTravelKnowledge(props.knowledge), null, 2)}\n`, {
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}
