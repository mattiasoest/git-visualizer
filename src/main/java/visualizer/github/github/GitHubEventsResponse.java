package visualizer.github.github;

import java.util.List;
import java.util.Optional;

import visualizer.github.github.model.GitHubEvent;

public record GitHubEventsResponse(
		List<GitHubEvent> events,
		Optional<String> etag,
		int pollIntervalSeconds,
		boolean notModified
) {
}
