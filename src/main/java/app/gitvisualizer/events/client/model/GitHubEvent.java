package app.gitvisualizer.events.client.model;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;
import tools.jackson.databind.JsonNode;

@JsonIgnoreProperties(ignoreUnknown = true)
public record GitHubEvent(
		String id,
		String type,
		Actor actor,
		RepoRef repo,
		Actor org,
		JsonNode payload,
		@JsonProperty("public") boolean isPublic,
		@JsonProperty("created_at") String createdAt
) {
}
