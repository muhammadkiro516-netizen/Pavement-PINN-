import React from 'react';

/** Navigation the route layer hands down (features never import the router). */
export const WorkspaceNavContext = React.createContext<{ openQueue?: () => void }>({});
