"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";

/**
 * Renders a QR encoding the ordering link for a place:
 *   {APP_URL}/menu?place={placeId}
 * Scanning it opens the menu with the delivery destination pre-set.
 */
export default function PlaceQR({
  placeId,
  placeName,
}: {
  placeId: string;
  placeName: string;
}) {
  const [dataUrl, setDataUrl] = useState<string>("");

  const orderUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/menu?place=${placeId}`
      : "";

  useEffect(() => {
    if (!orderUrl) return;
    QRCode.toDataURL(orderUrl, { width: 320, margin: 2 })
      .then(setDataUrl)
      .catch(() => setDataUrl(""));
  }, [orderUrl]);

  function download() {
    if (!dataUrl) return;
    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = `zenoeats-${placeName.toLowerCase().replace(/\s+/g, "-")}.png`;
    a.click();
  }

  return (
    <div className="flex flex-col items-center gap-2">
      {dataUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={dataUrl} alt={`QR code for ${placeName}`} className="h-24 w-24" />
      ) : (
        <div className="h-24 w-24 animate-pulse rounded bg-neutral-100" />
      )}
      <button
        onClick={download}
        disabled={!dataUrl}
        className="text-xs font-medium text-brand hover:underline disabled:opacity-50"
      >
        Download
      </button>
    </div>
  );
}
