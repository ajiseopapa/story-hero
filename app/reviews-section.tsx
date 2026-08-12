"use client";

// 첫 화면에 보여주는 후기 목록. 승인된 것만 내려온다.
import { useEffect, useState } from "react";
import { formatDate, type PublicReview } from "@/lib/reviews";

export default function ReviewsSection() {
  const [reviews, setReviews] = useState<PublicReview[]>([]);

  useEffect(() => {
    fetch("/api/review")
      .then((r) => r.json())
      .then((d: { reviews?: PublicReview[] }) => setReviews(d.reviews ?? []))
      .catch(() => {});
  }, []);

  if (reviews.length === 0) return null;

  return (
    <section className="reviews">
      <h2>먼저 만들어 보신 분들</h2>
      <ul>
        {reviews.map((r) => (
          <li key={r.id}>
            <div className="review-head">
              <span className="review-rate" aria-label={`별점 ${r.rating}점`}>
                {"★".repeat(r.rating)}
                <i>{"★".repeat(5 - r.rating)}</i>
              </span>
              <span className="review-who">
                {r.nickname}
                {r.bookTitle && <em> · 《 {r.bookTitle} 》</em>}
              </span>
            </div>
            <p>{r.text}</p>
            <div className="review-date">{formatDate(r.createdAt)}</div>
          </li>
        ))}
      </ul>
    </section>
  );
}
