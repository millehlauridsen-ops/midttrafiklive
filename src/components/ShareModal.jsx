import styles from "./ShareModal.module.css";

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
        <h2 id="share-title">Del busafgang</h2>

        <p>
          Linje {selectedTrip.route_short_name} mod {selectedTrip.destination}
        </p>

        <button type="button" onClick={onBack}>
          Tilbage til afgangen
        </button>
      </section>
    </>
  );
}
