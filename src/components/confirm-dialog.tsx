export interface IConfirmDialogProps {
  title: string;
  /**
   * What will happen, said plainly and in full. Every destructive or bulk action names exactly
   * what it will do and to how many pull requests.
   */
  detail: React.ReactNode;
  confirmLabel: string;
  /**
   * Whether the confirming button should be styled as the dangerous one.
   */
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * A modal confirmation. Nothing that writes to GitHub happens without one.
 */
export function ConfirmDialog(props: IConfirmDialogProps) {
  return (
    <div className="modal" role="presentation" onClick={props.onCancel}>
      <div
        className="modal__box"
        role="dialog"
        aria-modal="true"
        aria-label={props.title}
        onClick={event => event.stopPropagation()}
      >
        <h2 className="modal__title">{props.title}</h2>
        <div className="modal__detail">{props.detail}</div>
        <div className="modal__buttons">
          <button className="button" type="button" onClick={props.onCancel}>Cancel</button>
          <button
            className={`button ${props.danger === true ? 'button--danger' : 'button--primary'}`}
            type="button"
            onClick={props.onConfirm}
          >
            {props.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
