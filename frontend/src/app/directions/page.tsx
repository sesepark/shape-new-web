import { ExternalLink, MapPin, Navigation, TrainFront } from "lucide-react";
import { PageShell } from "@/components/page-shell";

export const metadata = {
  title: "오시는 길",
  description:
    "서울대학교 301동 109호 SHAPE 활동 공간으로 오는 길을 안내합니다.",
};

const address = "서울특별시 관악구 관악로 1 서울대학교 301동 109호";
const mapUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;

export default function DirectionsPage() {
  return (
    <PageShell
      eyebrow="VISIT SHAPE"
      title="SHAPE"
      contentTitle="SHAPE를 찾아오시는 길"
    >
      <div className="directions-layout">
        <div className="directions-map-wrap">
          <iframe
            title="서울대학교 301동 109호 지도"
            loading="lazy"
            referrerPolicy="no-referrer-when-downgrade"
            src={`https://www.google.com/maps?q=${encodeURIComponent(address)}&output=embed`}
          />
        </div>
        <aside className="directions-info">
          <p className="meta">SHAPE LAB</p>
          <h3>서울대학교 301동 109호</h3>
          <p>
            서울대학교 관악캠퍼스 301동에서 SHAPE의 Physical AI 프로젝트와
            장비를 만나보실 수 있습니다.
          </p>
          <dl>
            <div>
              <dt>
                <MapPin size={17} />
                주소
              </dt>
              <dd>{address}</dd>
            </div>
            <div>
              <dt>
                <TrainFront size={17} />
                대중교통
              </dt>
              <dd>2호선 서울대입구역 3번 출구에서 교내 순환버스 이용</dd>
            </div>
          </dl>
          <a className="button" href={mapUrl} target="_blank" rel="noreferrer">
            <Navigation size={16} />
            Google 지도에서 길찾기 <ExternalLink size={14} />
          </a>
        </aside>
      </div>
    </PageShell>
  );
}
