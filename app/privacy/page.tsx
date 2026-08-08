import type { Metadata } from "next";
import LegalShell from "../legal-shell";
import { BUSINESS } from "@/lib/business";

export const metadata: Metadata = { title: "개인정보처리방침 · 동화 주인공" };

export default function PrivacyPage() {
  return (
    <LegalShell title="개인정보처리방침" updated="2026년 8월 8일">
      <p>
        {BUSINESS.name}(이하 &ldquo;회사&rdquo;)는 이용자의 개인정보를 소중히 다루며, 아래와 같이
        처리합니다. <b>본 서비스는 회원가입 없이 이용할 수 있으며, 회사는 이용자의 개인정보를
        서버에 저장하지 않습니다.</b>
      </p>

      <h2>1. 수집하는 정보와 이용 목적</h2>
      <table className="legal-table">
        <thead>
          <tr>
            <th>항목</th>
            <th>이용 목적</th>
            <th>보관</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>아이 사진</td>
            <td>동화 삽화 생성</td>
            <td>
              <b>서버에 저장하지 않음.</b> 생성 요청 처리 중에만 메모리에서 사용되며, 원본은
              이용자 기기(브라우저)에만 보관됩니다.
            </td>
          </tr>
          <tr>
            <td>아이 이름·나이·성별</td>
            <td>이야기 글과 그림의 개인화</td>
            <td>서버에 저장하지 않음. 이용자 기기에만 보관</td>
          </tr>
          <tr>
            <td>음성 녹음</td>
            <td>내 목소리로 읽어주기</td>
            <td>
              <b>이용자 기기(브라우저 IndexedDB)에만 저장.</b> 서버로 전송되지 않습니다.
            </td>
          </tr>
          <tr>
            <td>결제 정보</td>
            <td>유료 결제 승인</td>
            <td>
              토스페이먼츠가 처리하며 회사는 카드번호 등 결제수단 정보를 수집·보관하지 않습니다.
            </td>
          </tr>
          <tr>
            <td>접속 IP(암호화 처리)</td>
            <td>무료 샘플 남용 방지를 위한 일별 이용 횟수 제한</td>
            <td>원본이 아닌 복원 불가능한 해시 형태로 최대 24시간 보관 후 파기</td>
          </tr>
        </tbody>
      </table>

      <h2>2. 제3자 제공 및 처리위탁</h2>
      <p>회사는 서비스 제공을 위해 아래 업체에 처리를 위탁합니다.</p>
      <ul>
        <li>
          <b>OpenAI</b> — 이야기 글·삽화·음성 생성. 사진과 입력 정보가 생성 요청 시 전송되며, API를
          통한 요청은 해당 업체의 정책에 따라 AI 모델 학습에 사용되지 않습니다.
        </li>
        <li>
          <b>토스페이먼츠</b> — 결제 처리 및 결제 승인
        </li>
        <li>
          <b>Vercel</b> — 서비스 호스팅 및 이용 횟수 제한 데이터 보관
        </li>
      </ul>
      <p>회사는 위 목적 외에 이용자의 정보를 제3자에게 판매하거나 제공하지 않습니다.</p>

      <h2>3. 아동의 개인정보</h2>
      <p>
        본 서비스는 보호자가 이용하는 것을 전제로 합니다. 아이의 사진·이름 등은 <b>친권자 또는
        법정대리인의 동의</b> 아래 입력되어야 하며, 회사는 이를 서버에 저장하지 않고 생성 목적으로만
        일시 처리합니다.
      </p>

      <h2>4. 이용자의 권리</h2>
      <p>
        회사가 서버에 보관하는 개인정보가 없으므로, 이용자는 브라우저에서 &lsquo;새 동화
        만들기&rsquo;를 실행하거나 브라우저 저장소를 삭제하는 것으로 언제든 모든 정보를 완전히
        삭제할 수 있습니다. 문의사항은 아래 연락처로 언제든 요청하실 수 있습니다.
      </p>

      <h2>5. 개인정보 보호책임자</h2>
      <ul>
        <li>책임자: {BUSINESS.owner}</li>
        <li>이메일: {BUSINESS.email}</li>
        <li>전화: {BUSINESS.tel}</li>
      </ul>

      <h2>6. 고지의 의무</h2>
      <p>
        본 방침의 내용이 변경되는 경우 시행일 전에 서비스 화면을 통해 공지합니다.
      </p>
    </LegalShell>
  );
}
