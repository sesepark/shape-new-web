import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  CalendarDays,
  CheckCircle2,
  Clock3,
  Layers3,
} from "lucide-react";
import { PageShell } from "@/components/page-shell";
import { ShapeSymbol } from "@/components/shape-symbol";
import { api, listOrEmpty } from "@/lib/api";
import { media } from "@/lib/media";
import { mockEquipment } from "@/lib/mock-data";

async function equipmentById(id: string) {
  const equipment = await listOrEmpty(api.equipment(), mockEquipment);
  return equipment.find((item) => String(item.id) === id);
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const equipment = await equipmentById(id);
  if (!equipment) return { title: "장비를 찾을 수 없습니다" };
  return {
    title: equipment.name,
    description: equipment.description.slice(0, 155),
  };
}

export default async function EquipmentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const equipment = await equipmentById(id);
  if (!equipment) notFound();
  const status =
    equipment.status === "ACTIVE"
      ? "예약 가능"
      : equipment.status === "MAINTENANCE"
        ? "점검 중"
        : "도입 논의 중";
  return (
    <PageShell
      eyebrow="SHAPE EQUIPMENT"
      title="장비 예약"
      contentTitle="장비 상세"
    >
      <Link className="detail-back" href="/equipment">
        <ArrowLeft size={16} /> 장비 목록
      </Link>
      <article className="equipment-detail">
        <div className="equipment-detail-media">
          {equipment.imageUrl ? (
            <Image
              src={media(equipment.imageUrl, 980)}
              alt={`${equipment.name} 장비`}
              width={980}
              height={820}
              unoptimized
              priority
            />
          ) : (
            <div className="equipment-detail-placeholder">
              <ShapeSymbol className="equipment-detail-placeholder-symbol" />
              <span>SHAPE PHYSICAL AI EQUIPMENT</span>
            </div>
          )}
        </div>
        <div className="equipment-detail-copy">
          <p className="eyebrow">{equipment.category}</p>
          <div className="equipment-detail-title">
            <h2>{equipment.name}</h2>
            <span
              className={
                equipment.status === "ACTIVE" ? "status" : "status warn"
              }
            >
              {status}
            </span>
          </div>
          <p className="equipment-detail-description">
            {equipment.description}
          </p>
          <dl className="equipment-specs">
            <div>
              <dt>
                <Layers3 size={17} /> 보유 수량
              </dt>
              <dd>
                {equipment.availableUnits > 0
                  ? `${equipment.availableUnits}대`
                  : "도입 협의 중"}
              </dd>
            </div>
            <div>
              <dt>
                <Clock3 size={17} /> 이용 시간
              </dt>
              <dd>
                {equipment.openHour.toString().padStart(2, "0")}:00–
                {equipment.closeHour.toString().padStart(2, "0")}:00
              </dd>
            </div>
            <div>
              <dt>
                <CalendarDays size={17} /> 예약 단위
              </dt>
              <dd>{equipment.reservationUnitMinutes}분</dd>
            </div>
            <div>
              <dt>
                <CheckCircle2 size={17} /> 사전 조건
              </dt>
              <dd>{equipment.requiredLicenses.join(", ") || "운영진 확인"}</dd>
            </div>
          </dl>
          {equipment.status === "ACTIVE" ? (
            <Link
              className="button equipment-detail-cta"
              href={`/equipment/reserve?equipment=${equipment.id}`}
            >
              이 장비 예약하기 <CalendarDays size={17} />
            </Link>
          ) : (
            <p className="equipment-detail-notice">
              현재 예약을 받고 있지 않습니다. 도입 또는 점검 완료 후 상태가
              변경됩니다.
            </p>
          )}
        </div>
      </article>
    </PageShell>
  );
}
