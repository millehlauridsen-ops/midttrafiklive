import defaultBus from "../assets/sharingbus/defaultSharingbus.png";
import pokemonBus from "../assets/sharingbus/pokemonSharingbus.png";
import habboBus from "../assets/sharingbus/habboSharingbus.png";
import raveBus from "../assets/sharingbus/raveSharingbus.png";

import styles from "./ShareModal.module.css";

const sharingImages = {
  default: defaultBus,
  pokemon: pokemonBus,
  habbo: habboBus,
  rave: raveBus,
};

export default function ShareModal({ selectedTrip, selectedStop, onBack }) {
  async function handleShare() {
    const url = new URL("/", window.location.origin);

    url.searchParams.set("trip", selectedTrip.trip_id);
    url.searchParams.set("stop", selectedStop.stop_id);
    url.searchParams.set("departure", selectedTrip.departure_at);

    const shareData = {
      title: `Bus ${selectedTrip.route_short_name}`,
      text: `Jeg er med bus ${selectedTrip.route_short_name} mod ${selectedTrip.destination}`,
      url: url.toString(),
    };

    try {
      if (navigator.share) {
        await navigator.share(shareData);
      } else {
        await navigator.clipboard.writeText(url.toString());
        alert("Linket er kopieret!");
      }
    } catch (error) {
      if (error.name !== "AbortError") {
        console.error("Kunne ikke dele busafgangen:", error);
        alert("Kunne ikke dele linket.");
      }
    }
  }

  async function handleCopyLink() {
    const url = new URL("/", window.location.origin);

    url.searchParams.set("trip", selectedTrip.trip_id);
    url.searchParams.set("stop", selectedStop.stop_id);
    url.searchParams.set("departure", selectedTrip.departure_at);

    try {
      await navigator.clipboard.writeText(url.toString());
      alert("Linket er kopieret!");
    } catch (error) {
      console.error("Kunne ikke kopiere linket:", error);
      alert("Kunne ikke kopiere linket.");
    }
  }

  return (
    <>
      <div className={styles.backdrop} />

      <section
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-labelledby="share-title"
      >
        <h2 id="share-title">Jeg er med denne bus</h2>

        <img
          src={
            sharingImages[document.documentElement.dataset.theme] ?? defaultBus
          }
          alt=""
          className={styles.sharingIllustration}
        />

        <div className={styles.busDetails}>
          <strong>Linje {selectedTrip.route_short_name}</strong>
          <span>Mod {selectedTrip.destination}</span>
        </div>

        <button type="button" onClick={handleShare}>
          Del link til denne bus
        </button>

        <button type="button" onClick={handleCopyLink}>
          Kopiér link
        </button>

        <button type="button" onClick={onBack}>
          Tilbage til afgangen
        </button>
      </section>
    </>
  );
}
