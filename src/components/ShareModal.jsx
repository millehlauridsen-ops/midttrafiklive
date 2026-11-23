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

export default function ShareModal({ selectedTrip, onBack }) {
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

        <button type="button" onClick={onBack}>
          Tilbage til afgangen
        </button>
      </section>
    </>
  );
}
