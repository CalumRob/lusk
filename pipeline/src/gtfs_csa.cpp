#include <Rcpp.h>
#include <algorithm>
#include <cmath>
#include <limits>
#include <string>
#include <unordered_map>
#include <unordered_set>
#include <vector>

using namespace Rcpp;

namespace {
struct Connection {
  std::string from;
  std::string to;
  std::string trip;
  double departure;
  double arrival;
};

struct WalkEdge {
  std::string from;
  double minutes;
};

struct Rule {
  int type;
  double minimum;
};

struct Label {
  double arrival;
  double departure;
  double duration;
  int transfers;
  int walking_transfers;
  std::string trip;
};

struct Best {
  bool found = false;
  double duration = std::numeric_limits<double>::infinity();
  double departure = NA_REAL;
  double arrival = NA_REAL;
  int transfers = 0;
  int walking_transfers = 0;
};

struct FrontierNode {
  std::size_t first = std::numeric_limits<std::size_t>::max();
  std::size_t second = std::numeric_limits<std::size_t>::max();
};

struct FrontierLocation {
  std::size_t stop = 0;
  std::size_t leaf = 0;
  std::size_t position = 0;
};

static bool better_label(std::size_t a, std::size_t b,
                         const std::vector<Label>& labels) {
  if (a == std::numeric_limits<std::size_t>::max()) return false;
  if (b == std::numeric_limits<std::size_t>::max()) return true;
  const Label& x = labels[a];
  const Label& y = labels[b];
  if (x.departure != y.departure) return x.departure > y.departure;
  if (x.transfers != y.transfers) return x.transfers < y.transfers;
  if (x.walking_transfers != y.walking_transfers)
    return x.walking_transfers < y.walking_transfers;
  return x.arrival < y.arrival;
}

static FrontierNode merge_frontiers(const FrontierNode& a, const FrontierNode& b,
                                    const std::vector<Label>& labels) {
  const std::size_t candidates[] = {a.first, a.second, b.first, b.second};
  FrontierNode result;
  for (std::size_t candidate : candidates) {
    if (candidate == std::numeric_limits<std::size_t>::max()) continue;
    if (result.first != std::numeric_limits<std::size_t>::max() &&
        labels[result.first].trip == labels[candidate].trip) {
      if (better_label(candidate, result.first, labels)) result.first = candidate;
      continue;
    }
    if (result.second != std::numeric_limits<std::size_t>::max() &&
        labels[result.second].trip == labels[candidate].trip) {
      if (better_label(candidate, result.second, labels)) result.second = candidate;
      continue;
    }
    if (better_label(candidate, result.first, labels)) {
      result.second = result.first;
      result.first = candidate;
    } else if (better_label(candidate, result.second, labels)) {
      result.second = candidate;
    }
  }
  return result;
}

class ArrivalFrontiers {
  struct Stop {
    std::vector<double> arrivals;
    std::size_t base = 1;
    std::vector<FrontierNode> tree;
    std::vector<std::vector<std::size_t>> leaves;
  };
  std::unordered_map<std::string, std::size_t> stop_ids_;
  std::vector<Stop> stops_;

  void update(std::size_t stop_id, std::size_t leaf,
              const std::vector<Label>& labels) {
    Stop& stop = stops_[stop_id];
    std::size_t node = stop.base + leaf;
    FrontierNode value;
    for (std::size_t id : stop.leaves[leaf]) {
      FrontierNode singleton{id, std::numeric_limits<std::size_t>::max()};
      value = merge_frontiers(value, singleton, labels);
    }
    stop.tree[node] = value;
    while (node > 1) {
      node /= 2;
      stop.tree[node] = merge_frontiers(stop.tree[node * 2],
                                        stop.tree[node * 2 + 1], labels);
    }
  }

public:
  explicit ArrivalFrontiers(const std::vector<Connection>& connections) {
    std::unordered_map<std::string, std::vector<double>> coordinates;
    for (const auto& connection : connections)
      coordinates[connection.to].push_back(connection.arrival);
    stops_.reserve(coordinates.size());
    for (auto& item : coordinates) {
      Stop stop;
      stop.arrivals = std::move(item.second);
      std::sort(stop.arrivals.begin(), stop.arrivals.end());
      stop.arrivals.erase(std::unique(stop.arrivals.begin(), stop.arrivals.end()),
                          stop.arrivals.end());
      while (stop.base < stop.arrivals.size()) stop.base *= 2;
      stop.tree.resize(stop.base * 2);
      stop.leaves.resize(stop.arrivals.size());
      stop_ids_.emplace(item.first, stops_.size());
      stops_.push_back(std::move(stop));
    }
  }

  void add(std::size_t id, const std::string& stop_name, double arrival,
           std::vector<FrontierLocation>& locations,
           const std::vector<Label>& labels) {
    const std::size_t stop_id = stop_ids_.at(stop_name);
    Stop& stop = stops_[stop_id];
    const std::size_t leaf = static_cast<std::size_t>(
      std::lower_bound(stop.arrivals.begin(), stop.arrivals.end(), arrival) -
      stop.arrivals.begin());
    auto& bucket = stop.leaves[leaf];
    locations[id] = {stop_id, leaf, bucket.size()};
    bucket.push_back(id);
    update(stop_id, leaf, labels);
  }

  void remove(std::size_t id, std::vector<FrontierLocation>& locations,
              const std::vector<Label>& labels) {
    const FrontierLocation location = locations[id];
    Stop& stop = stops_[location.stop];
    auto& bucket = stop.leaves[location.leaf];
    const std::size_t replacement = bucket.back();
    bucket[location.position] = replacement;
    bucket.pop_back();
    if (replacement != id) {
      locations[replacement].position = location.position;
    }
    update(location.stop, location.leaf, labels);
  }

  std::pair<std::size_t, std::size_t> query(
      const std::string& stop_name, double ready, const std::string& excluded_trip,
      const std::vector<Label>& labels, std::size_t& nodes_visited) const {
    auto found = stop_ids_.find(stop_name);
      if (found == stop_ids_.end()) return {std::numeric_limits<std::size_t>::max(),
                                            std::numeric_limits<std::size_t>::max()};
    const Stop& stop = stops_[found->second];
    const auto end_it = std::upper_bound(stop.arrivals.begin(), stop.arrivals.end(), ready);
    if (end_it == stop.arrivals.begin()) return {std::numeric_limits<std::size_t>::max(),
                                                 std::numeric_limits<std::size_t>::max()};
    std::size_t left = stop.base;
    std::size_t right = stop.base + static_cast<std::size_t>(end_it - stop.arrivals.begin());
    FrontierNode result;
    while (left < right) {
      if (left & 1U) {
        result = merge_frontiers(result, stop.tree[left++], labels);
        ++nodes_visited;
      }
      if (right & 1U) {
        result = merge_frontiers(result, stop.tree[--right], labels);
        ++nodes_visited;
      }
      left /= 2;
      right /= 2;
    }
    if (result.first != std::numeric_limits<std::size_t>::max() &&
        labels[result.first].trip == excluded_trip)
      return {result.second, result.first};
    return {result.first, result.second};
  }
};

static std::string pair_key(const std::string& from, const std::string& to) {
  return from + '\x1f' + to;
}

static std::string state_key(const std::string& stop, const std::string& trip) {
  return stop + '\x1e' + trip;
}

static bool insert_label(std::unordered_map<std::string, std::vector<std::size_t>>& labels,
                         std::vector<Label>& all_labels,
                         std::vector<unsigned char>& active,
                         ArrivalFrontiers& frontiers,
                         std::vector<FrontierLocation>& locations,
                         const std::string& stop, const std::string& trip,
                         const Label& value, std::size_t& inserted,
                         std::size_t& compacted) {
  const std::string key = state_key(stop, trip);
  auto& state = labels[key];
  state.erase(std::remove_if(state.begin(), state.end(), [&](std::size_t id) {
    return !active[id];
  }), state.end());
  for (std::size_t id : state) {
    if (!active[id]) continue;
    const Label& old = all_labels[id];
    if (old.arrival <= value.arrival && old.duration <= value.duration &&
        (old.arrival < value.arrival || old.duration < value.duration ||
         old.transfers < value.transfers ||
         (old.transfers == value.transfers &&
          old.walking_transfers <= value.walking_transfers))) return false;
  }
  const std::size_t id = all_labels.size();
  all_labels.push_back(value);
  active.push_back(1);
  locations.resize(id + 1);
  frontiers.add(id, stop, value.arrival, locations, all_labels);
  state.push_back(id);
  std::vector<std::size_t> dominated;
  for (std::size_t old_id : state) {
    if (old_id == id || !active[old_id]) continue;
    const Label& old = all_labels[old_id];
    if (value.arrival <= old.arrival && value.duration <= old.duration &&
        (value.arrival < old.arrival || value.duration < old.duration ||
         value.transfers < old.transfers ||
         (value.transfers == old.transfers &&
          value.walking_transfers < old.walking_transfers))) {
      active[old_id] = 0;
      frontiers.remove(old_id, locations, all_labels);
      dominated.push_back(old_id);
    }
  }
  compacted += dominated.size();
  ++inserted;
  return true;
}
} // namespace

// Event scan over dated, ordered ride connections. Same-departure events are
// rescanned to a fixed point so zero-dwell connections do not depend on row order.
// Stop indexes point at active label storage by integer ID (not Label copies);
// this avoids a second large string-bearing label corpus and exact per-candidate
// scans through state maps to rediscover whether a stop index is still active.
// [[Rcpp::export]]
Rcpp::List csa_multi_target(Rcpp::DataFrame rides,
                            Rcpp::DataFrame walks,
                            Rcpp::CharacterVector origins,
                            Rcpp::List destination_sets,
                            double window_start,
                            double window_end,
                            Rcpp::DataFrame rules) {
  CharacterVector from = rides["from_stop_id"];
  CharacterVector to = rides["to_stop_id"];
  CharacterVector trip = rides["trip_id"];
  NumericVector dep = rides["departure_min"];
  NumericVector arr = rides["arrival_min"];
  const int n = rides.nrows();
  std::vector<Connection> connections;
  connections.reserve(n);
  for (int i = 0; i < n; ++i) {
    connections.push_back({as<std::string>(from[i]), as<std::string>(to[i]),
                           as<std::string>(trip[i]), dep[i], arr[i]});
  }
  std::vector<int> order(n);
  for (int i = 0; i < n; ++i) order[i] = i;
  std::stable_sort(order.begin(), order.end(), [&](int a, int b) {
    if (connections[a].departure != connections[b].departure)
      return connections[a].departure < connections[b].departure;
    return connections[a].arrival < connections[b].arrival;
  });

  CharacterVector walk_from = walks["from_stop_id"];
  CharacterVector walk_to = walks["to_stop_id"];
  NumericVector walk_min = walks["duration_min"];
  std::unordered_map<std::string, std::vector<WalkEdge>> incoming_walks;
  for (int i = 0; i < walks.nrows(); ++i) {
    incoming_walks[as<std::string>(walk_to[i])].push_back(
      {as<std::string>(walk_from[i]), walk_min[i]});
  }

  CharacterVector rule_from = rules["from_stop_id"];
  CharacterVector rule_to = rules["to_stop_id"];
  CharacterVector rule_type = rules["transfer_type"];
  NumericVector rule_seconds(rules.nrows(), 0.0);
  if (rules.containsElementNamed("min_transfer_time")) {
    CharacterVector seconds = rules["min_transfer_time"];
    for (int i = 0; i < rules.nrows(); ++i) {
      if (seconds[i] != NA_STRING && LENGTH(seconds[i]) > 0)
        rule_seconds[i] = std::stod(as<std::string>(seconds[i]));
    }
  }
  std::unordered_map<std::string, Rule> rule_map;
  for (int i = 0; i < rules.nrows(); ++i) {
    rule_map[pair_key(as<std::string>(rule_from[i]), as<std::string>(rule_to[i]))] =
      {std::stoi(as<std::string>(rule_type[i])), rule_seconds[i] / 60.0};
  }

  std::unordered_set<std::string> origin_set;
  for (auto x : origins) if (x != NA_STRING) origin_set.insert(as<std::string>(x));

  CharacterVector target_names = destination_sets.names();
  std::unordered_map<std::string, std::vector<int>> targets_by_stop;
  std::vector<std::string> target_names_cpp;
  for (int k = 0; k < destination_sets.size(); ++k) {
    std::string name = as<std::string>(target_names[k]);
    target_names_cpp.push_back(name);
    CharacterVector stops = destination_sets[k];
    for (auto x : stops) if (x != NA_STRING)
      targets_by_stop[as<std::string>(x)].push_back(k);
  }

  std::unordered_map<std::string, std::vector<std::size_t>> state_labels;
  std::vector<Label> all_labels;
  std::vector<unsigned char> active_labels;
  std::vector<FrontierLocation> frontier_locations;
  ArrivalFrontiers arrival_frontiers(connections);
  std::vector<Best> best(destination_sets.size());
  std::size_t inserted = 0;
  std::size_t transfer_checks = 0;
  std::size_t labels_examined = 0;
  std::size_t stale_labels_examined = 0;
  std::size_t compacted_labels = 0;
  std::size_t arrival_frontier_queries = 0;
  std::size_t arrival_frontier_nodes = 0;
  std::unordered_set<std::string> origin_names = origin_set;
  for (int k = 0; k < destination_sets.size(); ++k) {
    CharacterVector d = destination_sets[k];
    for (auto x : d) if (x != NA_STRING && origin_names.count(as<std::string>(x))) {
      best[k] = {true, 0.0, NA_REAL, NA_REAL, 0};
      break;
    }
  }

  auto record = [&](const std::string& stop, const Label& label) {
    auto it = targets_by_stop.find(stop);
    if (it == targets_by_stop.end()) return;
    for (int target : it->second) {
      Best& b = best[target];
      if (!b.found || label.duration < b.duration ||
          (label.duration == b.duration && label.transfers < b.transfers)) {
        b = {true, label.duration, label.departure, label.arrival,
             label.transfers, label.walking_transfers};
      }
    }
  };

  std::size_t cursor = 0;
  while (cursor < order.size()) {
    const double event_time = connections[order[cursor]].departure;
    std::size_t end = cursor;
    while (end < order.size() && connections[order[end]].departure == event_time) ++end;
    bool can_zero_chain = false;
    for (std::size_t p = cursor; p < end; ++p)
      if (connections[order[p]].arrival == event_time) can_zero_chain = true;
    bool changed = true;
    bool first_pass = true;
    while (first_pass || (changed && can_zero_chain)) {
      first_pass = false;
      changed = false;
      for (std::size_t p = cursor; p < end; ++p) {
        const Connection& c = connections[order[p]];
        if (c.arrival < c.departure) continue;
        auto wit = incoming_walks.find(c.from);
        std::vector<std::pair<std::string, double>> candidates;
        candidates.emplace_back(c.from, 0.0);
        if (wit != incoming_walks.end()) {
          for (const auto& walk : wit->second)
            candidates.emplace_back(walk.from, walk.minutes);
        }

        if (origin_set.count(c.from) && c.departure >= window_start &&
            c.departure < window_end) {
          Label first{c.arrival, c.departure, c.arrival - c.departure,
                      0, 0, c.trip};
          record(c.to, first);
          if (insert_label(state_labels, all_labels, active_labels,
                           arrival_frontiers, frontier_locations, c.to, c.trip,
                           first, inserted, compacted_labels))
            changed = true;
        }

        for (const auto& candidate : candidates) {
          Rule rule{0, 0.0};
          auto rit = rule_map.find(pair_key(candidate.first, c.from));
          if (rit != rule_map.end()) rule = rit->second;
          const bool same_stop = candidate.first == c.from;
          std::size_t selected = std::numeric_limits<std::size_t>::max();

          // Same-trip continuation at the same stop bypasses transfer rules and
          // walking. Its state is narrow (one stop/trip), so inspect only that
          // trip's Pareto labels, never every label at the stop.
          if (same_stop) {
            auto state = state_labels.find(state_key(c.from, c.trip));
            if (state != state_labels.end()) {
              const std::vector<std::size_t> state_snapshot = state->second;
              for (std::size_t id : state_snapshot) {
                ++labels_examined;
                const Label& label = all_labels[id];
                if (label.arrival <= c.departure &&
                    better_label(id, selected, all_labels)) selected = id;
              }
            }
            if (selected != std::numeric_limits<std::size_t>::max()) {
              const Label& previous = all_labels[selected];
              ++transfer_checks;
              Label next{c.arrival, previous.departure,
                         c.arrival - previous.departure, previous.transfers,
                         previous.walking_transfers, c.trip};
              record(c.to, next);
              if (insert_label(state_labels, all_labels, active_labels,
                               arrival_frontiers, frontier_locations, c.to,
                               c.trip, next, inserted, compacted_labels))
                changed = true;
            }
          }

          // All other eligible labels incur a transfer. A type-3 rule forbids
          // this branch; the same-trip branch above remains legal.
          if (rule.type == 3) continue;
          const double minimum = rule.type == 2 ? rule.minimum : 0.0;
          const double ready = c.departure - std::max(candidate.second, minimum);
          const std::string excluded_trip = same_stop ? c.trip : std::string();
          ++arrival_frontier_queries;
          const auto pair = arrival_frontiers.query(
            candidate.first, ready, excluded_trip, all_labels,
            arrival_frontier_nodes);
          selected = pair.first;
          if (selected == std::numeric_limits<std::size_t>::max()) continue;
          // Every candidate on this outgoing ride reaches the same arrival and
          // last-trip state. Therefore the eligible label with the latest
          // initial departure minimizes elapsed journey time; merge_frontiers
          // breaks equal-departure ties by transfer count (then walk count).
          const Label& previous = all_labels[selected];
          ++transfer_checks;
          Label next{c.arrival, previous.departure,
                     c.arrival - previous.departure,
                     previous.transfers + 1,
                      previous.walking_transfers +
                        (candidate.second > 0 ? 1 : 0),
                     c.trip};
          record(c.to, next);
          if (insert_label(state_labels, all_labels, active_labels,
                           arrival_frontiers, frontier_locations, c.to, c.trip,
                           next, inserted, compacted_labels))
            changed = true;
        }
      }
    }
    cursor = end;
  }

  List journeys(best.size());
  journeys.attr("names") = target_names;
  for (std::size_t k = 0; k < best.size(); ++k) {
    Best b = best[k];
    journeys[k] = List::create(
      _["travel_time_min"] = b.found ? b.duration : NA_REAL,
      _["departure_min"] = b.found ? b.departure : NA_REAL,
      _["arrival_min"] = b.found ? b.arrival : NA_REAL,
      _["transfers"] = b.found ? b.transfers : NA_INTEGER,
      _["walking_transfers"] = b.found ? b.walking_transfers : NA_INTEGER);
  }
  return List::create(
    _["journeys"] = journeys,
    _["metrics"] = List::create(
      _["connections_scanned"] = static_cast<double>(connections.size()),
      _["labels_inserted"] = static_cast<double>(inserted),
      _["labels_retained"] = static_cast<double>([&]() {
        std::size_t n = 0;
         n = static_cast<std::size_t>(std::count(active_labels.begin(),
                                                 active_labels.end(), 1));
        return n;
      }()),
      _["transfer_edges"] = static_cast<double>(walks.nrows()),
      _["label_checks"] = static_cast<double>(transfer_checks),
      _["labels_examined"] = static_cast<double>(labels_examined),
      _["stale_labels_examined"] = static_cast<double>(stale_labels_examined),
      _["labels_compacted"] = static_cast<double>(compacted_labels),
      _["arrival_frontier_queries"] = static_cast<double>(arrival_frontier_queries),
      _["arrival_frontier_nodes"] = static_cast<double>(arrival_frontier_nodes))
  );
}
