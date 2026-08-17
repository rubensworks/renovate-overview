import type { GroupMode, GroupSortKey, IFilters, SortKey } from '../lib/selectors';
import { GROUP_LABELS, GROUP_SORT_LABELS, SORT_LABELS } from '../lib/selectors';
import type { IViewState } from '../lib/urlState';

export interface IFilterBarProps {
  view: IViewState;
  owners: string[];
  managers: string[];
  depTypes: string[];
  updateTypes: string[];
  /**
   * How many pull requests the filters are hiding, so a filtered-to-nothing view says why.
   */
  hiddenCount: number;
  onChange: (view: IViewState) => void;
}

interface IToggle {
  name: keyof IFilters;
  label: string;
  title: string;
}

const TOGGLES: IToggle[] = [
  { name: 'onlyFailing', label: 'Failing', title: 'Only pull requests whose checks failed or errored' },
  { name: 'onlyPassing', label: 'Passing', title: 'Only pull requests whose checks all passed' },
  { name: 'onlyConflicting', label: 'Conflicting', title: 'Only pull requests that no longer merge cleanly' },
  { name: 'onlyMergeable', label: 'Mergeable', title: 'Only pull requests GitHub says merge cleanly' },
  { name: 'hideDrafts', label: 'No drafts', title: 'Hide draft pull requests' },
  { name: 'onlyMergeableByMe', label: 'I can merge', title: 'Only repositories you have write access to' },
];

/**
 * The controls above the list: how to group it, how to sort it, and what to leave out.
 */
export function FilterBar(props: IFilterBarProps) {
  const { view, onChange, hiddenCount } = props;
  const { filters } = view;

  function setFilters(next: Partial<IFilters>): void {
    onChange({ ...view, filters: { ...filters, ...next }});
  }

  return (
    <div className="filters">
      <div className="filters__row">
        <input
          className="filters__search"
          type="search"
          placeholder="Filter by repository, dependency, title or branch…"
          aria-label="Filter"
          value={filters.query}
          onChange={event => setFilters({ query: event.target.value })}
        />

        <label className="filters__field">
          <span className="filters__label">Group</span>
          <select
            className="filters__select"
            value={view.group}
            onChange={event => onChange({ ...view, group: event.target.value as GroupMode })}
          >
            {Object.entries(GROUP_LABELS).map(([ value, label ]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </label>

        <label className="filters__field">
          <span className="filters__label">Sort</span>
          <select
            className="filters__select"
            value={view.sort}
            onChange={event => onChange({ ...view, sort: event.target.value as SortKey })}
          >
            {Object.entries(SORT_LABELS).map(([ value, label ]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </label>

        {view.group === 'none' ?
          null :
            (
              <label className="filters__field">
                <span className="filters__label">Groups by</span>
                <select
                  className="filters__select"
                  value={view.groupSort}
                  onChange={event => onChange({ ...view, groupSort: event.target.value as GroupSortKey })}
                >
                  {Object.entries(GROUP_SORT_LABELS).map(([ value, label ]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </label>
            )}
      </div>

      <div className="filters__row">
        {TOGGLES.map(toggle => (
          <button
            key={toggle.name}
            className={`button ${filters[toggle.name] === true ? 'button--active' : ''}`}
            type="button"
            title={toggle.title}
            aria-pressed={filters[toggle.name] === true}
            onClick={() => setFilters({ [toggle.name]: !(filters[toggle.name] === true) })}
          >
            {toggle.label}
          </button>
        ))}

        <select
          className="filters__select"
          aria-label="Owner"
          value={filters.owner}
          onChange={event => setFilters({ owner: event.target.value })}
        >
          <option value="">All owners</option>
          {props.owners.map(owner => <option key={owner} value={owner}>{owner}</option>)}
        </select>

        <select
          className="filters__select"
          aria-label="Update type"
          value={filters.updateType}
          onChange={event => setFilters({ updateType: event.target.value })}
        >
          <option value="">All update types</option>
          {props.updateTypes.map(type => <option key={type} value={type}>{type}</option>)}
        </select>

        {props.managers.length === 0 ?
          null :
            (
              <select
                className="filters__select"
                aria-label="Manager"
                value={filters.manager}
                onChange={event => setFilters({ manager: event.target.value })}
              >
                <option value="">All managers</option>
                {props.managers.map(manager => <option key={manager} value={manager}>{manager}</option>)}
              </select>
            )}

        {props.depTypes.length === 0 ?
          null :
            (
              <select
                className="filters__select"
                aria-label="Dependency type"
                value={filters.depType}
                onChange={event => setFilters({ depType: event.target.value })}
              >
                <option value="">All dependency types</option>
                {props.depTypes.map(depType => <option key={depType} value={depType}>{depType}</option>)}
              </select>
            )}

        {hiddenCount > 0 ?
          <span className="filters__hidden">{hiddenCount} hidden by filters</span> :
          null}
      </div>
    </div>
  );
}
