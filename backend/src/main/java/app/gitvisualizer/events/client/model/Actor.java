package app.gitvisualizer.events.client.model;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;

@JsonIgnoreProperties(ignoreUnknown = true)
public record Actor(
		long id,
		String login,
		@JsonProperty("avatar_url") String avatarUrl
) {
}
