import React, { useState, useEffect } from 'react';

interface AKSIssue {
  id: string;
  title: string;
  url: string;
  body: string;
  createdAt: string;
  updatedAt: string;
  labels: Array<{
    name: string;
    color: string;
  }>;
  assignees: Array<{
    login: string;
    name: string | null;
    avatarUrl: string;
  }>;
  state: string;
  comments: number;
  lastComment?: {
    createdAt: string;
    author: {
      login: string;
      name: string | null;
    };
  } | null;
  needsResponse?: boolean;
  aiSummary?: {
    currentStatus: string;
    nextSteps: string;
    analysis: {
      isKnownIssue: boolean;
      isExpectedBehaviour: boolean;
      shouldClose: boolean;
    };
  } | null;
}

const AKSIssuesPage: React.FC = () => {
  const [issues, setIssues] = useState<AKSIssue[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedLabels, setSelectedLabels] = useState<Set<string>>(new Set());
  const [selectedAssignees, setSelectedAssignees] = useState<Set<string>>(new Set());
  const [selectedUnassigned, setSelectedUnassigned] = useState<boolean>(false);
  const [labelsDropdownOpen, setLabelsDropdownOpen] = useState(false);
  const [assigneesDropdownOpen, setAssigneesDropdownOpen] = useState(false);
  const [unassignedDropdownOpen, setUnassignedDropdownOpen] = useState(false);
  const [visibleColumns, setVisibleColumns] = useState<Set<string>>(new Set(['title', 'labels', 'assignees', 'created', 'updated', 'lastComment', 'needsResponse', 'ai']));
  const [columnsDropdownOpen, setColumnsDropdownOpen] = useState(false);
  const [sortField, setSortField] = useState<string>('');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [hoveredIssue, setHoveredIssue] = useState<string | null>(null);
  const [popoverPosition, setPopoverPosition] = useState<{x: number, y: number}>({x: 0, y: 0});
  const [progress, setProgress] = useState<{step: string, current: number, total: number} | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    fetchAKSIssues();
  }, []);

  const fetchAKSIssues = async (forceRefresh = false) => {
    let cleanup: (() => void) | null = null;
    
    try {
      setLoading(true);
      if (forceRefresh) {
        setRefreshing(true);
      }
      
      // Set up Server-Sent Events for progress updates for both initial load and refresh
      const eventSource = new EventSource('/api/progress?type=aks');
      eventSource.onmessage = (event) => {
        try {
          const progressData = JSON.parse(event.data);
          setProgress(progressData);
        } catch (e) {
          console.error('Failed to parse progress data:', e);
        }
      };
      
      eventSource.onerror = (error) => {
        console.error('EventSource error:', error);
        eventSource.close();
      };
      
      // Clean up event source when request completes
      cleanup = () => {
        eventSource.close();
        setProgress(null);
      };
      
      setTimeout(() => cleanup?.(), 600000); // Cleanup after 10 minutes (AKS processing can take a long time)
      
      const url = forceRefresh ? '/api/aks-issues?refresh=true' : '/api/aks-issues';
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const data = await response.json();
      setIssues(data);
      
      // Clean up when done
      cleanup?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch AKS issues');
      // Clean up on error too
      cleanup?.();
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const filteredIssues = issues.filter(issue => {
    const labelMatch = selectedLabels.size === 0 || 
      issue.labels.length === 0 || 
      issue.labels.some(label => selectedLabels.has(label.name));
    const assigneeMatch = selectedAssignees.size === 0 ||
      issue.assignees.some(assignee => selectedAssignees.has(assignee.name || assignee.login));
    const unassignedMatch = !selectedUnassigned || issue.assignees.length === 0;
    return labelMatch && assigneeMatch && unassignedMatch;
  });

  const sortedIssues = [...filteredIssues].sort((a, b) => {
    if (!sortField) return 0;
    
    let aValue: any, bValue: any;
    
    switch (sortField) {
      case 'title':
        aValue = a.title.toLowerCase();
        bValue = b.title.toLowerCase();
        break;
      case 'createdAt':
        aValue = new Date(a.createdAt);
        bValue = new Date(b.createdAt);
        break;
      case 'updatedAt':
        aValue = new Date(a.updatedAt);
        bValue = new Date(b.updatedAt);
        break;
      case 'lastComment':
        aValue = a.lastComment ? new Date(a.lastComment.createdAt) : new Date(0);
        bValue = b.lastComment ? new Date(b.lastComment.createdAt) : new Date(0);
        break;
      case 'comments':
        aValue = a.comments;
        bValue = b.comments;
        break;
      case 'assignees':
        aValue = a.assignees.length > 0 ? a.assignees[0].name || a.assignees[0].login : '';
        bValue = b.assignees.length > 0 ? b.assignees[0].name || b.assignees[0].login : '';
        aValue = aValue.toLowerCase();
        bValue = bValue.toLowerCase();
        break;
      default:
        return 0;
    }
    
    if (aValue < bValue) return sortDirection === 'asc' ? -1 : 1;
    if (aValue > bValue) return sortDirection === 'asc' ? 1 : -1;
    return 0;
  });

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  };

  const getTimeAgo = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffTime = Math.abs(now.getTime() - date.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    
    if (diffDays < 30) return `${diffDays} days ago`;
    if (diffDays < 365) return `${Math.floor(diffDays / 30)} months ago`;
    return `${Math.floor(diffDays / 365)} years ago`;
  };

  const uniqueLabels = [...new Set(issues.flatMap(issue => issue.labels.map(label => label.name)))].sort();
  const uniqueAssignees = [...new Set(issues.flatMap(issue => issue.assignees.map(assignee => assignee.name || assignee.login)))].sort();

  const handleLabelToggle = (label: string) => {
    const newSelected = new Set(selectedLabels);
    if (newSelected.has(label)) {
      newSelected.delete(label);
    } else {
      newSelected.add(label);
    }
    setSelectedLabels(newSelected);
  };

  const handleLabelSelectAll = () => {
    if (selectedLabels.size === uniqueLabels.length) {
      setSelectedLabels(new Set());
    } else {
      setSelectedLabels(new Set(uniqueLabels));
    }
  };

  const handleAssigneeToggle = (assignee: string) => {
    const newSelected = new Set(selectedAssignees);
    if (newSelected.has(assignee)) {
      newSelected.delete(assignee);
    } else {
      newSelected.add(assignee);
    }
    setSelectedAssignees(newSelected);
  };

  const handleAssigneeSelectAll = () => {
    if (selectedAssignees.size === uniqueAssignees.length) {
      setSelectedAssignees(new Set());
    } else {
      setSelectedAssignees(new Set(uniqueAssignees));
    }
  };

  const handleUnassignedToggle = () => {
    setSelectedUnassigned(!selectedUnassigned);
  };

  const handleColumnToggle = (column: string) => {
    const newVisible = new Set(visibleColumns);
    if (newVisible.has(column)) {
      newVisible.delete(column);
    } else {
      newVisible.add(column);
    }
    setVisibleColumns(newVisible);
  };

  const handleSort = (field: string) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  const getSortIcon = (field: string) => {
    if (sortField !== field) return ' ↕️';
    return sortDirection === 'asc' ? ' ↑' : ' ↓';
  };

  const getAIThinksLabel = (aiSummary: AKSIssue['aiSummary']) => {
    if (!aiSummary) return null;
    
    const { isKnownIssue, isExpectedBehaviour, shouldClose } = aiSummary.analysis;
    
    if (isKnownIssue) return 'KNOWN ISSUE';
    if (isExpectedBehaviour) return 'EXPECTED BEHAVIOUR';
    if (shouldClose) return 'GOOD TO CLOSE';
    return null;
  };

  const handleMouseEnter = (issueId: string, event: React.MouseEvent) => {
    setHoveredIssue(issueId);
    setPopoverPosition({ x: event.clientX, y: event.clientY });
  };

  const handleMouseLeave = () => {
    setHoveredIssue(null);
  };

  if (loading) {
    return (
      <div className="container">
        <div className="loading">
          {progress ? (
            <div className="progress-container">
              <div className="progress-text">
                {progress.step}
              </div>
              <div className="progress-bar">
                <div 
                  className="progress-fill" 
                  style={{ width: `${(progress.current / progress.total) * 100}%` }}
                ></div>
              </div>
              <div className="progress-numbers">
                {progress.current} / {progress.total}
              </div>
            </div>
          ) : (
            'Loading Azure AKS issues...'
          )}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="container">
        <div className="error">
          Error: {error}
          <br />
          <small>Make sure your GitHub token is set in the .env file</small>
        </div>
      </div>
    );
  }

  return (
    <div className="container">
      <div className="header">
        <div className="header-content">
          <div className="title-section">
            <h1>Azure AKS Open Issues Analysis</h1>
            <p>Analyzing all open issues from Azure/AKS repository (~600 issues)</p>
          </div>
          <div className="header-buttons">
            <button 
              className="refresh-button-small"
              onClick={() => fetchAKSIssues(true)}
              disabled={refreshing}
            >
              {refreshing ? '⟳' : '↻'}
            </button>
          </div>
        </div>
      </div>

      <div className="filters">
        <div className="filters-horizontal">
          <div className="filter-item">
            <h3>Labels:</h3>
            <div className="dropdown-filter">
              <button 
                className="dropdown-toggle"
                onClick={() => setLabelsDropdownOpen(!labelsDropdownOpen)}
              >
                Labels ({selectedLabels.size}/{uniqueLabels.length}) ▼
              </button>
              {labelsDropdownOpen && (
                <div className="dropdown-content">
                  <div className="select-all-option">
                    <label className="checkbox-label">
                      <input
                        type="checkbox"
                        checked={selectedLabels.size === uniqueLabels.length}
                        onChange={handleLabelSelectAll}
                      />
                      <span>Select All</span>
                    </label>
                  </div>
                  <div className="dropdown-options">
                    {uniqueLabels.map(label => (
                      <label key={label} className="checkbox-label">
                        <input
                          type="checkbox"
                          checked={selectedLabels.has(label)}
                          onChange={() => handleLabelToggle(label)}
                        />
                        <span className="label-badge">{label}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
          
          <div className="filter-item">
            <h3>Assignees:</h3>
            <div className="dropdown-filter">
              <button 
                className="dropdown-toggle"
                onClick={() => setAssigneesDropdownOpen(!assigneesDropdownOpen)}
              >
                Assignees ({selectedAssignees.size}/{uniqueAssignees.length}) ▼
              </button>
              {assigneesDropdownOpen && (
                <div className="dropdown-content">
                  <div className="select-all-option">
                    <label className="checkbox-label">
                      <input
                        type="checkbox"
                        checked={selectedAssignees.size === uniqueAssignees.length}
                        onChange={handleAssigneeSelectAll}
                      />
                      <span>Select All</span>
                    </label>
                  </div>
                  <div className="dropdown-options">
                    {uniqueAssignees.map(assignee => (
                      <label key={assignee} className="checkbox-label">
                        <input
                          type="checkbox"
                          checked={selectedAssignees.has(assignee)}
                          onChange={() => handleAssigneeToggle(assignee)}
                        />
                        <span>{assignee}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
          
          <div className="filter-item">
            <h3>Assignment:</h3>
            <div className="dropdown-filter">
              <button 
                className="dropdown-toggle"
                onClick={() => setUnassignedDropdownOpen(!unassignedDropdownOpen)}
              >
                Assignment ▼
              </button>
              {unassignedDropdownOpen && (
                <div className="dropdown-content">
                  <div className="dropdown-options">
                    <label className="checkbox-label">
                      <input
                        type="checkbox"
                        checked={selectedUnassigned}
                        onChange={handleUnassignedToggle}
                      />
                      <span>Show only unassigned items</span>
                    </label>
                  </div>
                </div>
              )}
            </div>
          </div>
          
          <div className="filter-item">
            <h3>Columns:</h3>
            <div className="dropdown-filter">
              <button 
                className="dropdown-toggle"
                onClick={() => setColumnsDropdownOpen(!columnsDropdownOpen)}
              >
                Columns ({visibleColumns.size}/8) ▼
              </button>
              {columnsDropdownOpen && (
                <div className="dropdown-content">
                  <div className="dropdown-options">
                    <label className="checkbox-label">
                      <input
                        type="checkbox"
                        checked={visibleColumns.has('labels')}
                        onChange={() => handleColumnToggle('labels')}
                      />
                      <span>Labels</span>
                    </label>
                    <label className="checkbox-label">
                      <input
                        type="checkbox"
                        checked={visibleColumns.has('assignees')}
                        onChange={() => handleColumnToggle('assignees')}
                      />
                      <span>Assignees</span>
                    </label>
                    <label className="checkbox-label">
                      <input
                        type="checkbox"
                        checked={visibleColumns.has('created')}
                        onChange={() => handleColumnToggle('created')}
                      />
                      <span>Issue created</span>
                    </label>
                    <label className="checkbox-label">
                      <input
                        type="checkbox"
                        checked={visibleColumns.has('updated')}
                        onChange={() => handleColumnToggle('updated')}
                      />
                      <span>Issue updated</span>
                    </label>
                    <label className="checkbox-label">
                      <input
                        type="checkbox"
                        checked={visibleColumns.has('lastComment')}
                        onChange={() => handleColumnToggle('lastComment')}
                      />
                      <span>Last comment</span>
                    </label>
                    <label className="checkbox-label">
                      <input
                        type="checkbox"
                        checked={visibleColumns.has('needsResponse')}
                        onChange={() => handleColumnToggle('needsResponse')}
                      />
                      <span>Needs response</span>
                    </label>
                    <label className="checkbox-label">
                      <input
                        type="checkbox"
                        checked={visibleColumns.has('ai')}
                        onChange={() => handleColumnToggle('ai')}
                      />
                      <span>AI</span>
                    </label>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="roadmap-table">
        <table className="table">
          <thead>
            <tr>
              <th className="sortable" onClick={() => handleSort('title')}>
                Issue{getSortIcon('title')}
              </th>
              {visibleColumns.has('labels') && (
                <th>Labels</th>
              )}
              {visibleColumns.has('assignees') && (
                <th className="sortable" onClick={() => handleSort('assignees')}>
                  Assignees{getSortIcon('assignees')}
                </th>
              )}
              {visibleColumns.has('created') && (
                <th className="sortable" onClick={() => handleSort('createdAt')}>
                  Issue created{getSortIcon('createdAt')}
                </th>
              )}
              {visibleColumns.has('updated') && (
                <th className="sortable" onClick={() => handleSort('updatedAt')}>
                  Issue updated{getSortIcon('updatedAt')}
                </th>
              )}
              {visibleColumns.has('lastComment') && (
                <th className="sortable" onClick={() => handleSort('lastComment')}>
                  Last comment{getSortIcon('lastComment')}
                </th>
              )}
              {visibleColumns.has('needsResponse') && (
                <th>Needs response</th>
              )}
              {visibleColumns.has('ai') && (
                <th>AI</th>
              )}
            </tr>
          </thead>
          <tbody>
            {sortedIssues.map((issue) => (
              <tr key={issue.id}>
                <td>
                  <div className="feature-cell">
                    <a 
                      href={issue.url} 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="issue-title"
                    >
                      {issue.title}
                    </a>
                  </div>
                </td>
                {visibleColumns.has('labels') && (
                  <td>
                    <div className="labels">
                      {issue.labels.map((label) => (
                        <span 
                          key={label.name} 
                          className="label-badge table-label"
                          style={{ backgroundColor: `#${label.color}`, color: '#fff' }}
                        >
                          {label.name}
                        </span>
                      ))}
                    </div>
                  </td>
                )}
                {visibleColumns.has('assignees') && (
                  <td>
                    <div className="assignees">
                      {issue.assignees.length > 0 ? (
                        issue.assignees.map((assignee) => (
                          <div key={assignee.login} className="assignee">
                            <img src={assignee.avatarUrl} alt={assignee.login} />
                            <span>{assignee.name || assignee.login}</span>
                          </div>
                        ))
                      ) : (
                        <span style={{ color: '#666', fontSize: '12px' }}>Unassigned</span>
                      )}
                    </div>
                  </td>
                )}
                {visibleColumns.has('created') && (
                  <td>
                    <div className="date-info">
                      {formatDate(issue.createdAt)}
                      <br />
                      <small>({getTimeAgo(issue.createdAt)})</small>
                    </div>
                  </td>
                )}
                {visibleColumns.has('updated') && (
                  <td>
                    <div className="date-info">
                      {formatDate(issue.updatedAt)}
                      <br />
                      <small>({getTimeAgo(issue.updatedAt)})</small>
                    </div>
                  </td>
                )}
                {visibleColumns.has('lastComment') && (
                  <td>
                    <div className="date-info">
                      {issue.lastComment ? (
                        <>
                          {formatDate(issue.lastComment.createdAt)}
                          <br />
                          <small>by {issue.lastComment.author.name || issue.lastComment.author.login}</small>
                        </>
                      ) : (
                        <span style={{ color: '#666', fontSize: '12px' }}>No comments</span>
                      )}
                    </div>
                  </td>
                )}
                {visibleColumns.has('needsResponse') && (
                  <td>
                    {issue.needsResponse && (
                      <span className="needs-response-flag" title="Needs response from team">
                        🚩
                      </span>
                    )}
                  </td>
                )}
                {visibleColumns.has('ai') && (
                  <td>
                    <div 
                      className="ai-thinks-cell"
                      onMouseEnter={(e) => handleMouseEnter(issue.id, e)}
                      onMouseLeave={handleMouseLeave}
                    >
                      {issue.aiSummary ? (
                        <>
                          {getAIThinksLabel(issue.aiSummary) ? (
                            <span className="ai-thinks-label">
                              {getAIThinksLabel(issue.aiSummary)}
                            </span>
                          ) : (
                            <span className="ai-thinks-label" style={{ backgroundColor: '#6c757d' }}>
                              ANALYZED
                            </span>
                          )}
                          {hoveredIssue === issue.id && (
                            <div 
                              className="ai-summary-popover"
                              style={{
                                position: 'fixed',
                                top: popoverPosition.y + 10,
                                left: popoverPosition.x + 10,
                                zIndex: 1000
                              }}
                            >
                              <div className="ai-summary-content">
                                <h4>Current Status</h4>
                                <p>{issue.aiSummary.currentStatus}</p>
                                <h4>Next Steps</h4>
                                <p>{issue.aiSummary.nextSteps}</p>
                                <h4>Analysis</h4>
                                <ul>
                                  <li>Known Issue: {issue.aiSummary.analysis.isKnownIssue ? 'Yes' : 'No'}</li>
                                  <li>Expected Behaviour: {issue.aiSummary.analysis.isExpectedBehaviour ? 'Yes' : 'No'}</li>
                                  <li>Should Close: {issue.aiSummary.analysis.shouldClose ? 'Yes' : 'No'}</li>
                                </ul>
                              </div>
                            </div>
                          )}
                        </>
                      ) : (
                        <span className="ai-processing">Processing...</span>
                      )}
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default AKSIssuesPage;