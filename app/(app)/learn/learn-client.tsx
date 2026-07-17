"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Badge, Button, Card } from "@/components/ui";
import { api } from "@/lib/fetcher";

type Course = { id: string; title: string; description: string | null };
type Lesson = {
  id: string;
  position: number;
  title: string;
  kind: string;
  body: string | null;
  quiz: { questions: { q: string; options: string[] }[] } | null;
  myStatus: string;
  myScore: number | null;
};
type CourseDetail = { course: Course; lessons: Lesson[] };

export function LearnClient() {
  const [open, setOpen] = useState<string | null>(null);
  const { data: courses } = useQuery({ queryKey: ["learn"], queryFn: () => api<Course[]>("/api/learn") });
  const purchased = typeof window !== "undefined" && window.location.search.includes("purchased=1");

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Your courses</h1>
      {purchased && (
        <p className="rounded-md border border-border bg-card p-3 text-sm" data-testid="purchased-banner">
          🎉 Payment received! Your course unlocks within a minute — check your email for a sign-in link if
          you're new here, then refresh this page.
        </p>
      )}
      {courses?.length ? (
        <ul className="flex flex-col gap-2" data-testid="learn-list">
          {courses.map((c) => (
            <li key={c.id} className="rounded-md border border-border bg-card p-3 text-sm">
              <button className="w-full text-left" onClick={() => setOpen(open === c.id ? null : c.id)}>
                <span className="font-medium">{c.title}</span>
                {c.description && <p className="mt-1 text-muted">{c.description}</p>}
              </button>
              {open === c.id && <LearnCourse courseId={c.id} />}
            </li>
          ))}
        </ul>
      ) : (
        <Card title="Nothing here yet">
          <p className="text-sm text-muted">
            Courses you've purchased appear here. If you just bought one, the team may still be setting up
            your access.
          </p>
        </Card>
      )}
    </div>
  );
}

function LearnCourse({ courseId }: { courseId: string }) {
  const qc = useQueryClient();
  const key = ["learn-course", courseId];
  const { data } = useQuery({ queryKey: key, queryFn: () => api<CourseDetail>(`/api/courses/${courseId}`) });
  const complete = useMutation({
    mutationFn: (lessonId: string) => api(`/api/lessons/${lessonId}/complete`, { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
  });

  if (!data) return <p className="mt-2 text-muted">Loading…</p>;
  return (
    <div className="mt-3 flex flex-col gap-2 border-t border-border pt-3" data-testid="learn-lessons">
      {data.lessons.map((l) => (
        <div key={l.id} className="rounded-md border border-border p-2">
          <div className="flex items-center justify-between gap-2">
            <span>
              {l.position}. {l.title} <Badge>{l.kind}</Badge>
            </span>
            {l.myStatus === "done" ? (
              <Badge>✅ done{l.myScore != null && ` · ${Math.round(l.myScore * 100)}%`}</Badge>
            ) : l.quiz ? (
              <span className="text-xs text-muted">pass the quiz to complete</span>
            ) : (
              <Button variant="outline" onClick={() => complete.mutate(l.id)} data-testid="learn-complete">
                Mark done
              </Button>
            )}
          </div>
          {l.body && <p className="mt-1 whitespace-pre-wrap text-muted">{l.body}</p>}
          {l.quiz && l.myStatus !== "done" && (
            <LearnQuiz lessonId={l.id} quiz={l.quiz} onDone={() => qc.invalidateQueries({ queryKey: key })} />
          )}
        </div>
      ))}
    </div>
  );
}

function LearnQuiz({
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
    mutationFn: () =>
      api<{ score: number; passed: boolean }>(`/api/lessons/${lessonId}/quiz`, {
        method: "POST",
        body: JSON.stringify({ answers }),
      }),
    onSuccess: (r) => {
      setResult(r.passed ? `Passed — ${Math.round(r.score * 100)}% 🎉` : `Not yet — ${Math.round(r.score * 100)}%. Review and retry.`);
      if (r.passed) onDone();
    },
    onError: (e) => setResult((e as Error).message),
  });

  return (
    <div className="mt-2 flex flex-col gap-2 border-t border-border pt-2 text-sm">
      {quiz.questions.map((q, i) => (
        <div key={i}>
          <p className="font-medium">{i + 1}. {q.q}</p>
          {q.options.map((o, oi) => (
            <label key={oi} className="ml-2 flex items-center gap-2">
              <input
                type="radio"
                name={`lq-${lessonId}-${i}`}
                checked={answers[i] === oi}
                onChange={() => setAnswers(answers.map((a, ai) => (ai === i ? oi : a)))}
              />
              {o}
            </label>
          ))}
        </div>
      ))}
      <Button className="self-start" disabled={answers.includes(-1) || submit.isPending} onClick={() => submit.mutate()}>
        Submit answers
      </Button>
      {result && <p className="text-muted">{result}</p>}
    </div>
  );
}
