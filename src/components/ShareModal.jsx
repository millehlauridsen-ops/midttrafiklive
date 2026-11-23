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
    url.searchParams.set("route", selectedTrip.route_short_name);
    url.searchParams.set("destination", selectedTrip.destination);

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
      if (error.name === "AbortError") return;

      try {
        await navigator.clipboard.writeText(url.toString());
        alert("Linket er kopieret!");
      } catch (copyError) {
        console.error("Kunne ikke dele eller kopiere linket:", copyError);
        alert("Kunne ikke dele linket.");
      }
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
        <header className={styles.modalHeader}>
          <button
            type="button"
            className={styles.backButton}
            onClick={onBack}
            aria-label="Tilbage til afgangen"
          >
            <span className={styles.backIcon} aria-hidden="true" />
          </button>
        </header>

        <img
          src={
            sharingImages[document.documentElement.dataset.theme] ?? defaultBus
          }
          alt=""
          className={styles.sharingIllustration}
        />

        <div className={styles.shareHeading}>
          <span className={styles.shareKicker}>Del din bus</span>
          <h2 id="share-title">Jeg er med denne bus</h2>
        </div>

        <div className={styles.busDetails}>
          <strong>Linje {selectedTrip.route_short_name}</strong>
          <span>Mod {selectedTrip.destination}</span>
        </div>

        <button type="button" className={styles.shareButton} onClick={handleShare}>
          Del min bus
        </button>
      </section>
    </>
  );
}
