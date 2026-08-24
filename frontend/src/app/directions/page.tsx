import { ExternalLink, MapPin, Navigation, TrainFront } from "lucide-react";
import { PageShell } from "@/components/page-shell";

export const metadata = {
  title: "오시는 길",
  description:
    "서울대학교 공과대학 제1공학관(301동) 109호 SHAPE 활동 공간으로 오는 길을 안내합니다.",
};

const address = "서울특별시 관악구 관악로 1 서울대학교 301동 공과대학 제1공학관 109호";
// 주소 문자열로 검색하면 구글이 관악캠퍼스 곳곳의 건물을 한꺼번에 찍어 어디로
// 와야 하는지 알 수 없었습니다. 제1공학관 건물 좌표를 직접 넘겨 핀 하나만
// 남기고, 괄호 안 이름이 그 핀의 설명이 됩니다.
const place = { lat: 37.4498724, lng: 126.9524371, label: "서울대학교 301동 공과대학 제1공학관" };
const pin = `${place.lat},${place.lng}`;
const mapEmbedUrl = `https://www.google.com/maps?q=${encodeURIComponent(`${pin}(${place.label})`)}&z=17&hl=ko&output=embed`;
const mapUrl = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(pin)}`;

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
            title={`${place.label} 지도`}
            loading="lazy"
            referrerPolicy="no-referrer-when-downgrade"
            src={mapEmbedUrl}
          />
        </div>
        <aside className="directions-info">
          <p className="meta">SHAPE LAB</p>
          <h3>서울대학교 301동 109호</h3>
          <p>
            서울대학교 관악캠퍼스 공과대학 제1공학관(301동) 109호에서 SHAPE의
            Physical AI 프로젝트와 장비를 만나보실 수 있습니다.
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
