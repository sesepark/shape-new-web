import Link from "next/link";
import Image from "next/image";
import { ArrowUpRight, CalendarDays } from "lucide-react";
import { ShapeSymbol } from "@/components/shape-symbol";
import { EmptyState } from "@/components/empty-state";
import { PageShell } from "@/components/page-shell";
import { api, listOrEmpty } from "@/lib/api";
import { media, optimizable } from "@/lib/media";

export const metadata = {
  title: "보유 장비",
  description: "SHAPE가 운영하는 장비와 예약 가능 상태를 확인합니다.",
};

export default async function EquipmentPage() {
  const equipment = await listOrEmpty(api.equipment());
  return (
    <PageShell
      eyebrow="SHAPE EQUIPMENT"
      title="장비 예약"
      contentTitle="보유 장비"
    >
      <p className="lead equipment-lead">
        SHAPE가 운영하는 장비의 상태와 사용 조건을 확인할 수 있습니다. 승인된
        회원은 보유 라이선스에 따라 예약을 신청합니다.
      </p>
      <div className="equipment-catalog">
        {equipment.map((item, index) => (
          <article className="equipment-catalog-card" key={item.id}>
            <Link
              className="equipment-detail-link"
              href={`/equipment/${item.id}`}
              aria-label={`${item.name} 상세 정보`}
            >
              <div className="equipment-catalog-media">
                {item.imageUrl ? (
                  <Image
                    src={media(item.imageUrl, 720)}
                    alt={`${item.name} 장비`}
                    width={720}
                    height={620}
                    unoptimized={!optimizable(item.imageUrl)}
                  />
                ) : (
                  <div
                    className="equipment-catalog-placeholder"
                    aria-hidden="true"
                  >
                    <ShapeSymbol className="equipment-placeholder-symbol" />
                    <span>{String(index + 1).padStart(2, "0")}</span>
                  </div>
                )}
              </div>
              <div className="equipment-catalog-copy">
                <small>{item.category}</small>
                <h3>{item.name}</h3>
                <p>{item.description}</p>
              </div>
            </Link>
            <div className="equipment-catalog-actions">
              <span
                className={item.status === "ACTIVE" ? "status" : "status warn"}
              >
                {item.status === "ACTIVE"
                  ? "예약 가능"
                  : item.status === "MAINTENANCE"
                    ? "점검 중"
                    : "도입 논의 중"}
              </span>
              <Link href={`/equipment/${item.id}`}>
                상세 보기 <ArrowUpRight size={15} />
              </Link>
              {item.status === "ACTIVE" && (
                <Link href={`/equipment/reserve?equipment=${item.id}`}>
                  예약 <CalendarDays size={15} />
                </Link>
              )}
            </div>
          </article>
        ))}
      </div>
      {equipment.length === 0 && (
        <EmptyState
          title="등록된 장비가 없습니다"
          description="운영진이 관리자 페이지에서 장비 모델과 예약 단위를 등록하면 표시됩니다."
        />
      )}
    </PageShell>
  );
}
