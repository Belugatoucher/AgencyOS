"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Badge, Button, Card, Input, Select } from "@/components/ui";
import { api } from "@/lib/fetcher";

type Course = { id: string; title: string; description: string | null; status: string; lessonCount: number; required: boolean };
type Lesson = {
  id: string;
  position: number;
  title: string;
  kind: string;
  body: string | null;
  sopId: string | null;
  estMinutes: number | null;
  quiz: { pass_threshold: number; questions: { q: string; options: string[] }[] } | null;
  myStatus: string;
  myScore: number | null;
};
type CourseDetail = { course: Course; lessons: Lesson[] };
type MatrixRow = { userId: string; name: string; role: string; courses: { courseId: string; title: string; done: number; total: number }[] };
type KbHit = { citation: string; sourceTitle: string; text: string; similarity: number };
type NotebookAnswer = { answer: string; citations: string[]; confidence: string };
type Gap = { id: string; question: string; confidence: string };

const TABS = ["Courses", "Matrix", "Notebook", "Gaps"] as const;

export function AcademyClient({ isAdmin }: { isAdmin: boolean }) {
  const [tab, setTab] = useState<(typeof TABS)[number]>("Courses");
  const tabs = TABS.filter((t) => t !== "Matrix" || isAdmin);
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Academy</h1>
      <nav className="flex gap-1 border-b border-border text-sm">
        {tabs.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            data-testid={`academy-tab-${t.toLowerCase()}`}
            className={`rounded-t-md px-3 py-1.5 ${tab === t ? "border border-b-0 border-border bg-card font-medium" : "text-muted hover:text-foreground"}`}
          >
            {t}
          </button>
        ))}
      </nav>
      {tab === "Courses" && <CoursesPanel />}
      {tab === "Matrix" && isAdmin && <MatrixPanel />}
      {tab === "Notebook" && <NotebookPanel />}
      {tab === "Gaps" && <GapsPanel />}
    </div>
  );
}

function CoursesPanel() {
  const qc = useQueryClient();
  const [title, setTitle] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const { data: courses } = useQuery({ queryKey: ["courses"], queryFn: () => api<Course[]>("/api/courses") });

  const create = useMutation({
    mutationFn: () => api<Course>("/api/courses", { method: "POST", body: JSON.stringify({ title }) }),
    onSuccess: () => {
      setTitle("");
      qc.invalidateQueries({ queryKey: ["courses"] });
    },
  });
  const publish = useMutation({
    mutationFn: (id: string) => api(`/api/courses/${id}/publish`, { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["courses"] }),
  });

  return (
    <div className="flex flex-col gap-4">
      <Card title="New course">
        <div className="flex gap-2">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Course title" className="flex-1" data-testid="course-title" />
          <Button disabled={!title.trim() || create.isPending} onClick={() => create.mutate()} data-testid="course-create">
            Create
          </Button>
        </div>
      </Card>
      <Card title="Courses">
        {courses?.length ? (
          <ul className="flex flex-col gap-1 text-sm" data-testid="courses-list">
            {courses.map((c) => (
              <li key={c.id} className="rounded-md border border-border bg-card p-3">
                <div className="flex items-center justify-between gap-2">
                  <button className="min-w-0 text-left font-medium" onClick={() => setSelected(selected === c.id ? null : c.id)}>
                    {c.title}
                    <span className="ml-2 text-xs text-muted">{c.lessonCount} lesson(s)</span>
                  </button>
                  <span className="flex items-center gap-2">
                    {c.required && <Badge>required</Badge>}
                    <Badge>{c.status}</Badge>
                    {c.status === "draft" && (
                      <Button variant="outline" onClick={() => publish.mutate(c.id)} data-testid="course-publish">
                        Publish
                      </Button>
                    )}
                  </span>
                </div>
                {selected === c.id && <CourseDetailPanel courseId={c.id} />}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">No courses yet.</p>
        )}
      </Card>
    </div>
  );
}

function CourseDetailPanel({ courseId }: { courseId: string }) {
  const qc = useQueryClient();
  const key = ["course", courseId];
  const { data } = useQuery({ queryKey: key, queryFn: () => api<CourseDetail>(`/api/courses/${courseId}`) });
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState("doc");
  const [body, setBody] = useState("");

  const addLesson = useMutation({
    mutationFn: () =>
      api("/api/lessons", {
        method: "POST",
        body: JSON.stringify({
          courseId,
          position: (data?.lessons.length ?? 0) + 1,
          title,
          kind,
          body: body || null,
        }),
      }),
    onSuccess: () => {
      setTitle("");
      setBody("");
      qc.invalidateQueries({ queryKey: key });
      qc.invalidateQueries({ queryKey: ["courses"] });
    },
  });
  const complete = useMutation({
    mutationFn: (lessonId: string) => api(`/api/lessons/${lessonId}/complete`, { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
  });

  return (
    <div className="mt-3 flex flex-col gap-2 border-t border-border pt-3">
      {data?.lessons.map((l) => (
        <div key={l.id} className="rounded-md border border-border p-2">
          <div className="flex items-center justify-between gap-2">
            <span>
              {l.position}. {l.title} <Badge>{l.kind}</Badge>
            </span>
            <span className="flex items-center gap-2">
              {l.myStatus === "done" ? (
                <Badge>✅ done{l.myScore != null && ` · ${Math.round(l.myScore * 100)}%`}</Badge>
              ) : l.quiz ? (
                <span className="text-xs text-muted">complete by passing the quiz</span>
              ) : (
                <Button variant="outline" onClick={() => complete.mutate(l.id)} data-testid="lesson-complete">
                  Mark understood
                </Button>
              )}
            </span>
          </div>
          {l.body && <p className="mt-1 whitespace-pre-wrap text-muted">{l.body.slice(0, 500)}</p>}
          {l.quiz && l.myStatus !== "done" && <QuizForm lessonId={l.id} quiz={l.quiz} onDone={() => qc.invalidateQueries({ queryKey: key })} />}
        </div>
      ))}
      <div className="flex flex-wrap gap-2">
        <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Lesson title" className="flex-1" data-testid="lesson-title" />
        <Select value={kind} onChange={(e) => setKind(e.target.value)} data-testid="lesson-kind">
          <option value="doc">doc</option>
          <option value="video">video</option>
          <option value="sop">sop</option>
          <option value="quiz">quiz</option>
        </Select>
        <Button disabled={!title.trim() || addLesson.isPending} onClick={() => addLesson.mutate()} data-testid="lesson-add">
          Add lesson
        </Button>
      </div>
      {kind === "doc" && (
        <textarea
          className="rounded-md border border-border bg-card px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-accent"
          rows={3}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Lesson content (markdown)"
          data-testid="lesson-body"
        />
      )}
    </div>
  );
}

function QuizForm({
  lessonId,
  quiz,
  onDone,
}: {
  lessonId: string;
  quiz: { questions: { q: string; options: string[] }[] };
  onDone: () => void;
}) {
  const [answers, setAnswers] = useState<number[]>(Array(quiz.questions.length).fill(-1));
  const [result, setResult] = useState<string | null>(null);
  const submit = useMutation({
    mutationFn: () => api<{ score: number; passed: boolean }>(`/api/lessons/${lessonId}/quiz`, { method: "POST", body: JSON.stringify({ answers }) }),
    onSuccess: (r) => {
      setResult(r.passed ? `Passed — ${Math.round(r.score * 100)}% 🎉` : `Not yet — ${Math.round(r.score * 100)}%. Rewatch and retry.`);
      if (r.passed) onDone();
    },
    onError: (e) => setResult((e as Error).message),
  });

  return (
    <div className="mt-2 flex flex-col gap-2 border-t border-border pt-2 text-sm" data-testid="quiz-form">
      {quiz.questions.map((q, i) => (
        <div key={i}>
          <p className="font-medium">{i + 1}. {q.q}</p>
          {q.options.map((o, oi) => (
            <label key={oi} className="ml-2 flex items-center gap-2">
              <input
                type="radio"
                name={`q-${lessonId}-${i}`}
                checked={answers[i] === oi}
                onChange={() => setAnswers(answers.map((a, ai) => (ai === i ? oi : a)))}
              />
              {o}
            </label>
          ))}
        </div>
      ))}
      <Button
        className="self-start"
        disabled={answers.includes(-1) || submit.isPending}
        onClick={() => submit.mutate()}
        data-testid="quiz-submit"
      >
        Submit answers
      </Button>
      {result && <p className="text-muted">{result}</p>}
    </div>
  );
}

function MatrixPanel() {
  const { data: rows } = useQuery({ queryKey: ["matrix"], queryFn: () => api<MatrixRow[]>("/api/academy/matrix") });
  const courses = rows?.[0]?.courses ?? [];
  return (
    <Card title="Completion matrix (people × published courses)">
      {rows?.length && courses.length ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm" data-testid="matrix-table">
            <thead>
              <tr className="text-left text-xs text-muted">
                <th className="p-2">Person</th>
                {courses.map((c) => (
                  <th key={c.courseId} className="p-2">{c.title}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.userId} className="border-t border-border">
                  <td className="p-2 font-medium">{r.name} <span className="text-xs text-muted">({r.role})</span></td>
                  {r.courses.map((c) => (
                    <td key={c.courseId} className="p-2">
                      {c.total === 0 ? "—" : c.done === c.total ? "✅" : `${c.done}/${c.total}`}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-sm text-muted">Publish a course to see the matrix.</p>
      )}
    </Card>
  );
}

function NotebookPanel() {
  const [q, setQ] = useState("");
  const [log, setLog] = useState<{ role: "you" | "notebook"; text: string; citations?: string[] }[]>([]);
  const ask = useMutation({
    mutationFn: (question: string) => api<NotebookAnswer>("/api/notebook", { method: "POST", body: JSON.stringify({ question }) }),
    onSuccess: (r) => setLog((l) => [...l, { role: "notebook", text: r.answer, citations: r.citations }]),
    onError: (e) => setLog((l) => [...l, { role: "notebook", text: `⚠️ ${(e as Error).message}` }]),
  });
  const { data: hits } = useQuery({
    queryKey: ["kb-search", q],
    queryFn: () => api<KbHit[]>(`/api/notebook?q=${encodeURIComponent(q)}`),
    enabled: q.trim().length >= 3,
  });

  return (
    <Card title="Ask the Handbook">
      <p className="mb-2 text-xs text-muted">
        Answers come only from SOPs and lesson transcripts — client questions belong in Ask the Brain.
      </p>
      <div className="flex flex-col gap-2" data-testid="notebook-log">
        {log.map((m, i) => (
          <div key={i} className={`rounded-md border border-border p-3 text-sm ${m.role === "you" ? "bg-background" : "bg-card"}`}>
            <p className="mb-1 text-xs font-medium text-muted">{m.role === "you" ? "You" : "Handbook"}</p>
            <p className="whitespace-pre-wrap">{m.text}</p>
            {m.citations && m.citations.length > 0 && (
              <p className="mt-2 flex flex-wrap gap-1">
                {m.citations.map((c) => (
                  <Badge key={c}>{c}</Badge>
                ))}
              </p>
            )}
          </div>
        ))}
        {ask.isPending && <p className="text-sm text-muted">Reading the handbook…</p>}
      </div>
      <form
        className="mt-3 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const text = q.trim();
          if (!text) return;
          setLog((l) => [...l, { role: "you", text }]);
          setQ("");
          ask.mutate(text);
        }}
      >
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="How do we run kickoffs?" className="flex-1" data-testid="notebook-input" />
        <Button type="submit" disabled={ask.isPending} data-testid="notebook-send">
          Ask
        </Button>
      </form>
      {q.trim().length >= 3 && hits && hits.length > 0 && (
        <div className="mt-3 border-t border-border pt-2 text-xs text-muted" data-testid="kb-hits">
          Top matches: {hits.slice(0, 3).map((h) => `${h.sourceTitle} (${(h.similarity * 100).toFixed(0)}%)`).join(" · ")}
        </div>
      )}
    </Card>
  );
}

function GapsPanel() {
  const { data: gaps } = useQuery({ queryKey: ["gaps"], queryFn: () => api<Gap[]>("/api/notebook/gaps") });
  return (
    <Card title="SOPs we're missing (open Notebook gaps)">
      {gaps?.length ? (
        <ul className="flex flex-col gap-1 text-sm" data-testid="gaps-list">
          {gaps.map((g) => (
            <li key={g.id} className="flex items-center justify-between rounded-md border border-border bg-card p-3">
              <span>{g.question}</span>
              <Badge>{g.confidence}</Badge>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted">No open gaps — the handbook is keeping up.</p>
      )}
    </Card>
  );
}
